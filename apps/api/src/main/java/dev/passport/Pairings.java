package dev.passport;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.SecureRandom;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/pairings")
public class Pairings {
  final JdbcTemplate db;
  final Auth auth;
  final Folders folders;
  final Plans plans;
  final MemoryService memories;
  final SecureRandom random = new SecureRandom();

  public Pairings(
      JdbcTemplate db, Auth auth, Folders folders, Plans plans, MemoryService memories) {
    this.db = db;
    this.auth = auth;
    this.folders = folders;
    this.plans = plans;
    this.memories = memories;
  }

  record Create(
      @NotBlank String folderId, @NotNull @Pattern(regexp = "viewer|editor") String role) {}

  record Code(@NotNull @Pattern(regexp = "[0-9]{12}") String code) {}

  @PostMapping
  @Transactional
  Object create(HttpServletRequest r, @Valid @RequestBody Create b) {
    auth.origin(r);
    String owner = auth.user(r);
    plans.lock(owner);
    folders.access(owner, b.folderId(), true, true);
    long now = System.currentTimeMillis();
    db.update("DELETE FROM folder_pairings WHERE expires_at<?", now);
    db.update("DELETE FROM folder_pairings WHERE folder_id=? AND completed=FALSE", b.folderId());
    if (db.queryForObject(
            "SELECT COUNT(*) FROM folder_pairings WHERE owner_id=?", Integer.class, owner)
        >= 20) throw Auth.error(429, "TOO_MANY_PAIRINGS");
    String code = String.format(Locale.ROOT, "%012d", random.nextLong(1_000_000_000_000L));
    String id = UUID.randomUUID().toString();
    long expires = now + 600_000;
    db.update(
        "INSERT INTO folder_pairings(id,folder_id,owner_id,code_hash,role,expires_at)"
            + " VALUES(?,?,?,?,?,?)",
        id,
        b.folderId(),
        owner,
        Crypto.hash(code),
        b.role(),
        expires);
    return Map.of("id", id, "code", code, "expiresAt", expires);
  }

  Map<String, Object> row(String id, boolean lock) {
    var rows =
        db.queryForList(
            "SELECT * FROM folder_pairings WHERE id=?" + (lock ? " FOR UPDATE" : ""), id);
    if (rows.isEmpty()) throw Auth.error(404, "PAIRING_INVALID_OR_EXPIRED");
    return rows.getFirst();
  }

  void live(Map<String, Object> p) {
    if (((Number) p.get("expires_at")).longValue() <= System.currentTimeMillis())
      throw Auth.error(410, "PAIRING_INVALID_OR_EXPIRED");
  }

  @GetMapping("/{id}")
  Object status(HttpServletRequest r, @PathVariable String id) {
    String user = auth.user(r);
    var p = row(id, false);
    if (!user.equals(p.get("owner_id")) && !user.equals(p.get("receiver_id")))
      throw Auth.error(404, "PAIRING_INVALID_OR_EXPIRED");
    String state =
        Boolean.TRUE.equals(p.get("completed"))
            ? "complete"
            : ((Number) p.get("expires_at")).longValue() <= System.currentTimeMillis()
                ? "expired"
                : p.get("receiver_id") == null ? "waiting" : "ready";
    String receiver = "";
    if (p.get("receiver_id") != null) {
      var names =
          db.queryForList("SELECT username FROM accounts WHERE user_id=?", p.get("receiver_id"));
      receiver =
          names.isEmpty()
              ? p.get("receiver_id").toString()
              : names.getFirst().get("username").toString();
    }
    return Map.of(
        "id",
        id,
        "state",
        state,
        "receiver",
        receiver,
        "folderId",
        p.get("folder_id"),
        "role",
        p.get("role"),
        "expiresAt",
        p.get("expires_at"));
  }

  @PostMapping("/join")
  @Transactional
  Object join(HttpServletRequest r, @Valid @RequestBody Code b) {
    auth.origin(r);
    String user = auth.user(r);
    var rows =
        db.queryForList(
            "SELECT * FROM folder_pairings WHERE code_hash=? FOR UPDATE", Crypto.hash(b.code()));
    if (rows.isEmpty()) throw Auth.error(404, "PAIRING_INVALID_OR_EXPIRED");
    var p = rows.getFirst();
    live(p);
    if (Boolean.TRUE.equals(p.get("completed"))) throw Auth.error(409, "PAIRING_ALREADY_USED");
    if (user.equals(p.get("owner_id"))) throw Auth.error(400, "PAIRING_DIFFERENT_ACCOUNT_REQUIRED");
    if (p.get("receiver_id") != null && !user.equals(p.get("receiver_id")))
      throw Auth.error(409, "PAIRING_ALREADY_CLAIMED");
    db.update("UPDATE folder_pairings SET receiver_id=? WHERE id=?", user, p.get("id"));
    return Map.of("id", p.get("id"));
  }

  @PostMapping("/{id}/confirm")
  @Transactional
  Object confirm(HttpServletRequest r, @PathVariable String id, @Valid @RequestBody Code b) {
    auth.origin(r);
    String owner = auth.user(r);
    plans.lock(owner);
    var p = row(id, true);
    if (!owner.equals(p.get("owner_id"))) throw Auth.error(403, "FOLDER_ACCESS_DENIED");
    live(p);
    if (Boolean.TRUE.equals(p.get("completed"))) throw Auth.error(409, "PAIRING_ALREADY_USED");
    if (!Crypto.hash(b.code()).equals(p.get("code_hash")))
      throw Auth.error(400, "PAIRING_CODE_MISMATCH");
    if (p.get("receiver_id") == null) throw Auth.error(409, "PAIRING_RECEIVER_REQUIRED");
    String folder = p.get("folder_id").toString(), receiver = p.get("receiver_id").toString();
    folders.access(owner, folder, true, true);
    String role = p.get("role").toString();
    var members =
        db.queryForList(
            "SELECT role FROM folder_members WHERE folder_id=? AND user_id=?", folder, receiver);
    if (!members.isEmpty() && "editor".equals(members.getFirst().get("role"))) role = "editor";
    db.update("DELETE FROM folder_members WHERE folder_id=? AND user_id=?", folder, receiver);
    db.update("INSERT INTO folder_members VALUES(?,?,?)", folder, receiver, role);
    plans.enforce(owner);
    db.update("UPDATE folder_pairings SET completed=TRUE WHERE id=?", id);
    memories.audit(owner, receiver, "FOLDER_PAIRED", folder, "ALLOW", null);
    return Map.of("folderId", folder);
  }

  @DeleteMapping("/{id}")
  @Transactional
  Object cancel(HttpServletRequest r, @PathVariable String id) {
    auth.origin(r);
    String owner = auth.user(r);
    plans.lock(owner);
    var p = row(id, true);
    if (!owner.equals(p.get("owner_id"))) throw Auth.error(403, "FOLDER_ACCESS_DENIED");
    db.update("DELETE FROM folder_pairings WHERE id=?", id);
    return Map.of("ok", true);
  }
}
