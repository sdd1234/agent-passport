package dev.passport;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/billing")
public class Billing {
  @org.springframework.beans.factory.annotation.Value(
      "${passport.billing.webhook-secret:${STRIPE_WEBHOOK_SECRET:}}")
  String webhookSecret;

  final Auth auth;
  final Plans plans;
  final JdbcTemplate db;
  final ObjectMapper json;

  public Billing(Auth auth, Plans plans, JdbcTemplate db, ObjectMapper json) {
    this.auth = auth;
    this.plans = plans;
    this.db = db;
    this.json = json;
  }

  boolean configured() {
    return Config.origin().startsWith("https://")
        && !Config.env("STRIPE_SECRET_KEY", "").isBlank()
        && !Config.env("STRIPE_PRICE_ID", "").isBlank()
        && !Config.env("STRIPE_WEBHOOK_SECRET", "").isBlank();
  }

  @GetMapping
  Object status(HttpServletRequest r) {
    String user = auth.user(r);
    return Map.of(
        "usage",
        plans.usage(user),
        "checkoutEnabled",
        configured(),
        "subscription",
        db.queryForList("SELECT status,price_id FROM subscriptions WHERE user_id=?", user));
  }

  JsonNode stripe(String path, Map<String, String> body, String key) {
    if (!configured()) throw Auth.error(503, "BILLING_NOT_CONFIGURED");
    try {
      var b =
          HttpRequest.newBuilder(URI.create("https://api.stripe.com/v1/" + path))
              .timeout(Duration.ofSeconds(20))
              .header("Authorization", "Bearer " + Config.env("STRIPE_SECRET_KEY", ""));
      if (body != null) {
        String encoded =
            body.entrySet().stream()
                .map(
                    e ->
                        URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                            + "="
                            + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(java.util.stream.Collectors.joining("&"));
        b.header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(encoded));
        if (key != null) b.header("Idempotency-Key", key);
      }
      var response =
          HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() / 100 != 2) throw Auth.error(502, "BILLING_PROVIDER_ERROR");
      return json.readTree(response.body());
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw Auth.error(502, "BILLING_UNAVAILABLE");
    }
  }

  @PostMapping("/checkout")
  @Transactional
  Object checkout(HttpServletRequest r) {
    auth.origin(r);
    String user = auth.user(r);
    plans.lock(user);
    if (!configured()) throw Auth.error(503, "BILLING_NOT_CONFIGURED");
    var rows = db.queryForList("SELECT * FROM subscriptions WHERE user_id=?", user);
    String customer;
    if (rows.isEmpty()) {
      customer =
          stripe("customers", Map.of("metadata[passport_user]", user), "passport-customer-" + user)
              .path("id")
              .asText();
      db.update(
          "INSERT INTO subscriptions VALUES(?,?,NULL,'none',NULL,?)",
          user,
          customer,
          System.currentTimeMillis());
    } else {
      customer = rows.getFirst().get("customer_id").toString();
      if (!List.of("none", "canceled", "incomplete_expired")
          .contains(rows.getFirst().get("status").toString()))
        throw Auth.error(409, "USE_BILLING_PORTAL");
    }
    if (!customer.matches("cus_[A-Za-z0-9]+")) throw Auth.error(502, "INVALID_BILLING_CUSTOMER");
    for (var subscription :
        stripe("subscriptions?customer=" + customer + "&status=all&limit=100", null, null)
            .path("data")) {
      if (!List.of("canceled", "incomplete_expired").contains(subscription.path("status").asText()))
        throw Auth.error(409, "USE_BILLING_PORTAL");
    }
    var open =
        stripe("checkout/sessions?customer=" + customer + "&status=open&limit=1", null, null)
            .path("data");
    if (!open.isEmpty()) return Map.of("url", open.path(0).path("url").asText());
    // Reuse a checkout session within the same window to prevent accidental repeated clicks.
    var response =
        stripe(
            "checkout/sessions",
            Map.of(
                "mode",
                "subscription",
                "customer",
                customer,
                "line_items[0][price]",
                Config.env("STRIPE_PRICE_ID", ""),
                "line_items[0][quantity]",
                "1",
                "success_url",
                Config.origin() + "/?billing=return",
                "cancel_url",
                Config.origin() + "/?billing=cancel",
                "client_reference_id",
                user),
            "passport-checkout-" + user + "-" + (System.currentTimeMillis() / 1800000));
    return Map.of("url", response.path("url").asText());
  }

  @PostMapping("/portal")
  Object portal(HttpServletRequest r) {
    auth.origin(r);
    var rows =
        db.queryForList("SELECT customer_id FROM subscriptions WHERE user_id=?", auth.user(r));
    if (rows.isEmpty()) throw Auth.error(404, "SUBSCRIPTION_NOT_FOUND");
    return Map.of(
        "url",
        stripe(
                "billing_portal/sessions",
                Map.of(
                    "customer",
                    rows.getFirst().get("customer_id").toString(),
                    "return_url",
                    Config.origin()),
                null)
            .path("url")
            .asText());
  }

  static void verify(String body, String header, String secret, long now) {
    if (secret.isBlank() || header == null) throw Auth.error(400, "INVALID_WEBHOOK_SIGNATURE");
    try {
      long timestamp = 0;
      List<String> signatures = new ArrayList<>();
      for (String p : header.split(",")) {
        String[] kv = p.split("=", 2);
        if (kv.length == 2) {
          if (kv[0].equals("t")) timestamp = Long.parseLong(kv[1]);
          if (kv[0].equals("v1")) signatures.add(kv[1]);
        }
      }
      if (Math.abs(now - timestamp) > 300) throw new IllegalArgumentException();
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] expected = mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8));
      boolean valid = false;
      for (String s : signatures)
        valid |= java.security.MessageDigest.isEqual(expected, HexFormat.of().parseHex(s));
      if (!valid) throw new IllegalArgumentException();
    } catch (Exception e) {
      throw Auth.error(400, "INVALID_WEBHOOK_SIGNATURE");
    }
  }

  @PostMapping("/webhook")
  @Transactional
  Object webhook(
      @RequestBody String body,
      @RequestHeader(value = "Stripe-Signature", required = false) String signature)
      throws Exception {
    verify(body, signature, webhookSecret, System.currentTimeMillis() / 1000);
    var event = json.readTree(body);
    String type = event.path("type").asText(), id = event.path("id").asText();
    if (!List.of(
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted")
        .contains(type)) return Map.of("received", true);
    var object = event.path("data").path("object");
    String customer = object.path("customer").asText(), subscription = object.path("id").asText();
    if (!subscription.matches("sub_[A-Za-z0-9]+") || !id.matches("evt_[A-Za-z0-9]+"))
      throw Auth.error(400, "INVALID_EVENT");
    var users = db.queryForList("SELECT user_id FROM subscriptions WHERE customer_id=?", customer);
    if (users.isEmpty()) return Map.of("received", true);
    String user = users.getFirst().get("user_id").toString();
    plans.lock(user);
    if (db.queryForObject("SELECT COUNT(*) FROM billing_events WHERE id=?", Integer.class, id) > 0)
      return Map.of("received", true);
    // Fetch current provider state, never trust event order or a browser redirect for entitlement.
    var latest = stripe("subscriptions/" + subscription, null, null);
    if (!latest.path("customer").asText().equals(customer))
      throw Auth.error(400, "CUSTOMER_MISMATCH");
    var current = db.queryForMap("SELECT * FROM subscriptions WHERE user_id=?", user);
    if (current.get("subscription_id") != null
        && !subscription.equals(current.get("subscription_id"))
        && !List.of("canceled", "incomplete_expired", "none")
            .contains(current.get("status").toString()))
      throw Auth.error(409, "MULTIPLE_SUBSCRIPTIONS");
    String price = latest.path("items").path("data").path(0).path("price").path("id").asText();
    db.update(
        "UPDATE subscriptions SET subscription_id=?,status=?,price_id=?,updated_at=? WHERE"
            + " user_id=?",
        subscription,
        latest.path("status").asText(),
        price,
        System.currentTimeMillis(),
        user);
    db.update("INSERT INTO billing_events VALUES(?,?)", id, System.currentTimeMillis());
    return Map.of("received", true);
  }

  @PostMapping("/sync")
  @Transactional
  Object sync(HttpServletRequest r) {
    auth.origin(r);
    syncUser(auth.user(r));
    return Map.of("ok", true);
  }

  @Transactional
  public void syncUser(String user) {
    plans.lock(user);
    var rows = db.queryForList("SELECT * FROM subscriptions WHERE user_id=?", user);
    if (rows.isEmpty() || rows.getFirst().get("subscription_id") == null) return;
    var row = rows.getFirst();
    String id = row.get("subscription_id").toString();
    if (!id.matches("sub_[A-Za-z0-9]+")) throw Auth.error(502, "INVALID_SUBSCRIPTION");
    var latest = stripe("subscriptions/" + id, null, null);
    if (!latest.path("customer").asText().equals(row.get("customer_id")))
      throw Auth.error(502, "CUSTOMER_MISMATCH");
    db.update(
        "UPDATE subscriptions SET status=?,price_id=?,updated_at=? WHERE user_id=?",
        latest.path("status").asText(),
        latest.path("items").path("data").path(0).path("price").path("id").asText(),
        System.currentTimeMillis(),
        user);
  }

  void prepareAccountDeletion(String user) {
    var rows = db.queryForList("SELECT customer_id FROM subscriptions WHERE user_id=?", user);
    if (rows.isEmpty()) return;
    if (!configured()) throw Auth.error(503, "BILLING_NOT_CONFIGURED");
    String customer = rows.getFirst().get("customer_id").toString();
    if (!customer.matches("cus_[A-Za-z0-9]+")) throw Auth.error(502, "INVALID_BILLING_CUSTOMER");
    for (var subscription :
        stripe("subscriptions?customer=" + customer + "&status=all&limit=100", null, null)
            .path("data"))
      if (!List.of("canceled", "incomplete_expired").contains(subscription.path("status").asText()))
        throw Auth.error(409, "CANCEL_SUBSCRIPTION_BEFORE_DELETING_ACCOUNT");
    for (var session :
        stripe("checkout/sessions?customer=" + customer + "&status=open&limit=100", null, null)
            .path("data")) {
      String id = session.path("id").asText();
      if (!id.matches("cs_[A-Za-z0-9_]+")) throw Auth.error(502, "INVALID_CHECKOUT_SESSION");
      stripe("checkout/sessions/" + id + "/expire", Map.of(), "passport-expire-" + id);
    }
  }
}
