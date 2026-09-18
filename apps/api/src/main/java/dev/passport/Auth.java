package dev.passport;

import jakarta.servlet.http.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Auth {
  public record Identity(String owner, String agent, boolean ownerSession) {}

  private final JdbcTemplate db;

  public Auth(JdbcTemplate db) {
    this.db = db;
  }

  public static ResponseStatusException error(int status, String code) {
    return new ResponseStatusException(HttpStatus.valueOf(status), code);
  }

  public String user(HttpServletRequest req) {
    if (req.getHeader("Authorization") != null) throw error(401, "LOGIN_REQUIRED");
    if (req.getCookies() != null)
      for (var cookie : req.getCookies()) {
        if (!Accounts.COOKIE.equals(cookie.getName())) continue;
        var sessions =
            db.queryForList(
                "SELECT user_id FROM account_sessions WHERE token_hash=? AND expires_at>?",
                Crypto.hash(cookie.getValue()),
                System.currentTimeMillis());
        if (!sessions.isEmpty()) return sessions.getFirst().get("user_id").toString();
      }
    Object id = req.getSession(false) == null ? null : req.getSession(false).getAttribute("owner");
    if (id == null) throw error(401, "LOGIN_REQUIRED");
    return id.toString();
  }

  public void origin(HttpServletRequest req) {
    String o = req.getHeader("Origin");
    if (o != null && !o.equals(Config.origin())) throw error(403, "ORIGIN_DENIED");
    if (req.getHeader("Authorization") != null) {
      identity(req);
      return;
    }
    if (!"1".equals(req.getHeader("X-Passport-Request"))) throw error(403, "CSRF_HEADER_REQUIRED");
  }

  public Identity identity(HttpServletRequest req) {
    String h = req.getHeader("Authorization");
    if (h != null) {
      if (!h.startsWith("Bearer ")) throw error(401, "INVALID_CREDENTIAL");
      var rows =
          db.queryForList("SELECT * FROM agents WHERE token_hash=?", Crypto.hash(h.substring(7)));
      if (rows.isEmpty()) throw error(401, "INVALID_CREDENTIAL");
      var a = rows.getFirst();
      String requested = req.getHeader("X-Agent-Id");
      if (requested != null && !requested.equals(a.get("id")))
        throw error(403, "AGENT_ID_MISMATCH");
      return new Identity(a.get("owner_id").toString(), a.get("id").toString(), false);
    }
    return new Identity(user(req), "owner", true);
  }

  public void ensureUser(String owner) {
    if (db.queryForObject("SELECT COUNT(*) FROM users WHERE id=?", Integer.class, owner) == 0)
      db.update(
          "INSERT INTO users VALUES(?,?,?)",
          owner,
          UUID.randomUUID().toString(),
          System.currentTimeMillis());
  }
}
