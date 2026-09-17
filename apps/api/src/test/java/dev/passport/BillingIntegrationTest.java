package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:billing;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
      "passport.billing.webhook-secret=fixture-secret",
      "passport.billing.price-id=price_fixture"
    })
@AutoConfigureMockMvc
class BillingIntegrationTest {
  @Autowired JdbcTemplate db;
  @Autowired Auth auth;
  @Autowired Plans plans;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @MockitoSpyBean Billing billing;
  String user;

  @BeforeEach
  void setup() {
    user = UUID.randomUUID().toString();
    auth.ensureUser(user);
    db.update("DELETE FROM billing_events");
    db.update("DELETE FROM subscriptions");
    db.update("INSERT INTO subscriptions VALUES(?,'cus_fixture',NULL,'none',NULL,0)", user);
  }

  String signature(String body) throws Exception {
    long t = System.currentTimeMillis() / 1000;
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec("fixture-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return "t="
        + t
        + ",v1="
        + HexFormat.of().formatHex(mac.doFinal((t + "." + body).getBytes(StandardCharsets.UTF_8)));
  }

  String event(String id) throws Exception {
    return json.writeValueAsString(
        Map.of(
            "id",
            id,
            "type",
            "customer.subscription.updated",
            "data",
            Map.of("object", Map.of("id", "sub_fixture", "customer", "cus_fixture"))));
  }

  JsonNode subscription(String status) throws Exception {
    return json.readTree(
        json.writeValueAsString(
            Map.of(
                "id",
                "sub_fixture",
                "customer",
                "cus_fixture",
                "status",
                status,
                "items",
                Map.of("data", List.of(Map.of("price", Map.of("id", "price_fixture")))))));
  }

  void send(String event) throws Exception {
    mvc.perform(
            post("/api/billing/webhook")
                .header("Stripe-Signature", signature(event))
                .contentType("application/json")
                .content(event))
        .andExpect(status().isOk());
  }

  @Test
  void providerConfirmedStateIdempotencyAndCancellation() throws Exception {
    doReturn(subscription("active"))
        .when(billing)
        .stripe(eq("subscriptions/sub_fixture"), isNull(), isNull());
    String first = event("evt_first");
    send(first);
    assertEquals("pro", plans.usage(user).get("plan"));
    send(first);
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM billing_events", Integer.class));
    verify(billing, times(1)).stripe(eq("subscriptions/sub_fixture"), isNull(), isNull());
    doReturn(subscription("canceled"))
        .when(billing)
        .stripe(eq("subscriptions/sub_fixture"), isNull(), isNull());
    send(event("evt_cancel"));
    assertEquals("free", plans.usage(user).get("plan"));
    // Late delivery still fetches current canceled state instead of enabling from an old event.
    send(event("evt_older"));
    assertEquals("free", plans.usage(user).get("plan"));
    mvc.perform(
            post("/api/billing/webhook")
                .header("Stripe-Signature", signature(first))
                .contentType("application/json")
                .content(first + " "))
        .andExpect(status().isBadRequest());
  }

  @Test
  void providerFailureIsRetryableAndCannotGrantPlan() throws Exception {
    doThrow(Auth.error(502, "BILLING_UNAVAILABLE"))
        .when(billing)
        .stripe(anyString(), isNull(), isNull());
    String event = event("evt_retry");
    mvc.perform(
            post("/api/billing/webhook")
                .header("Stripe-Signature", signature(event))
                .contentType("application/json")
                .content(event))
        .andExpect(status().isBadGateway());
    assertEquals("free", plans.usage(user).get("plan"));
    assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM billing_events", Integer.class));
    doReturn(subscription("active")).when(billing).stripe(anyString(), isNull(), isNull());
    send(event);
    assertEquals("pro", plans.usage(user).get("plan"));
  }
}
