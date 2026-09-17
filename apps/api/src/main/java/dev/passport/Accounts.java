package dev.passport;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.*;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/account")
public class Accounts {
  static final String COOKIE = "passport_session";
  final JdbcTemplate db;
  final Auth auth;

  public Accounts(JdbcTemplate db, Auth auth) {
    this.db = db;
    this.auth = auth;
  }

  public static String random() {
    byte[] b = new byte[32];
    new SecureRandom().nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  static String password(String value, String salt) {
    try {
      return salt
          + ":"
          + Base64.getEncoder()
              .encodeToString(
                  SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                      .generateSecret(
                          new PBEKeySpec(
                              value.toCharArray(), Base64.getDecoder().decode(salt), 600000, 256))
                      .getEncoded());
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static String hashPassword(String value) {
    byte[] b = new byte[16];
    new SecureRandom().nextBytes(b);
    return password(value, Base64.getEncoder().encodeToString(b));
  }

  static boolean matches(String value, String hash) {
    return MessageDigest.isEqual(
        password(value, hash.split(":")[0]).getBytes(java.nio.charset.StandardCharsets.UTF_8),
        hash.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  // Persisted rate buckets survive restarts; all app instances share the same limit.
  void throttle(HttpServletRequest r, String action) {
    long window = System.currentTimeMillis() / 600000;
    String ip = r.getRemoteAddr();
    if (Config.env("TRUST_PROXY_HEADER", "false").equals("true")) {
      String forwarded = r.getHeader("X-Passport-Client-IP");
      if (forwarded != null && forwarded.matches("[0-9a-fA-F:.]{2,64}")) ip = forwarded;
    }
    String key = Crypto.hash(action + ":" + ip + ":" + window);
    try {
      db.update("INSERT INTO request_limits VALUES(?,0,?)", key, (window + 1) * 600000);
    } catch (DuplicateKeyException ignored) {
    }
    if (db.update("UPDATE request_limits SET hits=hits+1 WHERE bucket=? AND hits<30", key) == 0)
      throw Auth.error(429, "TRY_LATER");
    db.update("DELETE FROM request_limits WHERE expires_at<?", System.currentTimeMillis());
  }

  record Credentials(
      @Pattern(regexp = "[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}") @NotNull String username,
      @Size(min = 12, max = 200) @NotNull String password) {}

  record Recover(
      @NotBlank String username,
      @NotBlank @Size(max = 100) String recoveryCode,
      @NotNull @Size(min = 12, max = 200) String password) {}

  void cookie(HttpServletResponse r, String token, long maxAge) {
    r.addHeader(
        "Set-Cookie",
        ResponseCookie.from(COOKIE, token)
            .httpOnly(true)
            .secure(Boolean.parseBoolean(Config.env("COOKIE_SECURE", "false")))
            .sameSite("Strict")
            .path("/api")
            .maxAge(maxAge)
            .build()
            .toString());
  }

  void session(HttpServletRequest req, HttpServletResponse res, String user) {
    if (req.getSession(false) != null) req.getSession(false).invalidate();
    if (req.getCookies() != null)
      for (var c : req.getCookies())
        if (COOKIE.equals(c.getName()))
          db.update("DELETE FROM account_sessions WHERE token_hash=?", Crypto.hash(c.getValue()));
    String token = random();
    db.update(
        "INSERT INTO account_sessions VALUES(?,?,?)",
        Crypto.hash(token),
        user,
        System.currentTimeMillis() + 604800000L);
    db.update("DELETE FROM account_sessions WHERE expires_at<?", System.currentTimeMillis());
    cookie(res, token, 604800);
  }

  @PostMapping("/register")
  Object register(
      HttpServletRequest r, HttpServletResponse res, @Valid @RequestBody Credentials b) {
    auth.origin(r);
    if (!Boolean.parseBoolean(Config.env("SIGNUP_ENABLED", "true")))
      throw Auth.error(403, "SIGNUP_DISABLED");
    String username = b.username().toLowerCase(Locale.ROOT),
        id = UUID.randomUUID().toString(),
        recovery = random();
    // TransactionTemplate ensures an unsuccessful unique insert does not leave an orphan user.
    var tx =
        new org.springframework.transaction.support.TransactionTemplate(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                Objects.requireNonNull(db.getDataSource())));
    String hash = hashPassword(b.password());
    try {
      tx.executeWithoutResult(
          s -> {
            auth.ensureUser(id);
            db.update(
                "INSERT INTO accounts VALUES(?,?,?,?,?)",
                id,
                username,
                hash,
                Crypto.hash(recovery),
                System.currentTimeMillis());
          });
    } catch (DuplicateKeyException e) {
      throw Auth.error(409, "USERNAME_UNAVAILABLE");
    }
    session(r, res, id);
    return Map.of("owner", id, "username", username, "recoveryCode", recovery);
  }

  @PostMapping("/login")
  Object login(HttpServletRequest r, HttpServletResponse res, @Valid @RequestBody Credentials b) {
    auth.origin(r);
    var rows =
        db.queryForList(
            "SELECT * FROM accounts WHERE username=?", b.username().toLowerCase(Locale.ROOT));
    String hash =
        rows.isEmpty()
            ? password("dummy-not-a-password", Base64.getEncoder().encodeToString(new byte[16]))
            : rows.getFirst().get("password_hash").toString();
    if (!matches(b.password(), hash) || rows.isEmpty()) throw Auth.error(401, "INVALID_LOGIN");
    String id = rows.getFirst().get("user_id").toString();
    session(r, res, id);
    return Map.of("owner", id, "username", rows.getFirst().get("username"));
  }

  @PostMapping("/recover")
  @Transactional
  Object recover(HttpServletRequest r, @Valid @RequestBody Recover b) {
    auth.origin(r);
    String recovery = random();
    int n =
        db.update(
            "UPDATE accounts SET password_hash=?,recovery_hash=? WHERE username=? AND"
                + " recovery_hash=?",
            hashPassword(b.password()),
            Crypto.hash(recovery),
            b.username().toLowerCase(Locale.ROOT),
            Crypto.hash(b.recoveryCode()));
    if (n != 1) throw Auth.error(401, "INVALID_RECOVERY");
    db.update(
        "DELETE FROM account_sessions WHERE user_id=(SELECT user_id FROM accounts WHERE"
            + " username=?)",
        b.username().toLowerCase(Locale.ROOT));
    return Map.of("recoveryCode", recovery);
  }

  @PostMapping("/logout")
  Object logout(HttpServletRequest r, HttpServletResponse res) {
    auth.origin(r);
    if (r.getCookies() != null)
      for (var c : r.getCookies())
        if (COOKIE.equals(c.getName()))
          db.update("DELETE FROM account_sessions WHERE token_hash=?", Crypto.hash(c.getValue()));
    if (r.getSession(false) != null) r.getSession(false).invalidate();
    cookie(res, "", 0);
    return Map.of("ok", true);
  }

  @GetMapping
  Object me(HttpServletRequest r) {
    String user = auth.user(r);
    var rows = db.queryForList("SELECT username,created_at FROM accounts WHERE user_id=?", user);
    return Map.of(
        "owner", user, "username", rows.isEmpty() ? user : rows.getFirst().get("username"));
  }
}
