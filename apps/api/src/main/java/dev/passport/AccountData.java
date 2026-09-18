package dev.passport;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/account")
public class AccountData {
  final Auth auth;
  final JdbcTemplate db;
  final Plans plans;
  final Entries entries;
  final MemoryService memories;
  final Accounts accounts;
  final Billing billing;

  public AccountData(
      Auth auth,
      JdbcTemplate db,
      Plans plans,
      Entries entries,
      MemoryService memories,
      Accounts accounts,
      Billing billing) {
    this.auth = auth;
    this.db = db;
    this.plans = plans;
    this.entries = entries;
    this.memories = memories;
    this.accounts = accounts;
    this.billing = billing;
  }

  @GetMapping("/export")
  Object export(HttpServletRequest r) {
    String user = auth.user(r);
    return Map.of(
        "schemaVersion",
        1,
        "folders",
        db.queryForList("SELECT id FROM workspace_folders WHERE owner_id=?", user).stream()
            .map(f -> entries.export(r, f.get("id").toString()))
            .toList(),
        "memories",
        memories.list(user, null, null, null).stream()
            .map(
                m ->
                    Map.of(
                        "memory", m, "versions", memories.versions(user, m.get("id").toString())))
            .toList(),
        "proposals",
        memories.conflicts(user),
        "bindings",
        db.queryForList("SELECT local_path,folder_id FROM project_bindings WHERE user_id=?", user));
  }

  record Delete(
      @NotBlank @Size(max = 200) String password,
      @NotNull @Pattern(regexp = "DELETE") String confirmation) {}

  @DeleteMapping
  @Transactional
  Object delete(HttpServletRequest r, HttpServletResponse res, @Valid @RequestBody Delete b) {
    auth.origin(r);
    String user = auth.user(r);
    plans.lock(user);
    var rows = db.queryForList("SELECT password_hash FROM accounts WHERE user_id=?", user);
    if (rows.isEmpty()
        || !Accounts.matches(b.password(), rows.getFirst().get("password_hash").toString()))
      throw Auth.error(401, "INVALID_LOGIN");
    if (db.queryForObject(
            "SELECT COUNT(*) FROM subscriptions WHERE user_id=? AND status NOT IN"
                + " ('none','canceled','incomplete_expired')",
            Integer.class,
            user)
        > 0) throw Auth.error(409, "CANCEL_SUBSCRIPTION_BEFORE_DELETING_ACCOUNT");
    billing.prepareAccountDeletion(user);
    db.update("DELETE FROM folder_pairings WHERE owner_id=? OR receiver_id=?", user, user);
    db.update(
        "DELETE FROM folder_entry_versions WHERE entry_id IN (SELECT e.id FROM folder_entries e"
            + " JOIN workspace_folders f ON e.folder_id=f.id WHERE f.owner_id=?)",
        user);
    for (String table :
        List.of(
            "folder_entries",
            "folder_changes",
            "folder_members",
            "folder_agent_grants",
            "folder_invites",
            "project_bindings"))
      db.update(
          "DELETE FROM "
              + table
              + " WHERE folder_id IN (SELECT id FROM workspace_folders WHERE owner_id=?)",
          user);
    for (String table : List.of("folder_members", "folder_agent_grants", "project_bindings"))
      db.update("DELETE FROM " + table + " WHERE user_id=?", user);
    db.update("UPDATE workspace_folders SET parent_id=NULL WHERE owner_id=?", user);
    db.update("DELETE FROM workspace_folders WHERE owner_id=?", user);
    if (db.queryForObject(
            "SELECT COUNT(*) FROM information_schema.tables WHERE"
                + " LOWER(table_name)='memory_embeddings'",
            Integer.class)
        > 0)
      db.update(
          "DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memories WHERE"
              + " owner_id=?)",
          user);
    db.update(
        "DELETE FROM versions WHERE memory_id IN (SELECT id FROM memories WHERE owner_id=?)", user);
    for (String table :
        List.of("memories", "proposals", "permissions", "agents", "anchors", "audit"))
      db.update("DELETE FROM " + table + " WHERE owner_id=?", user);
    for (String table : List.of("account_sessions", "subscriptions", "accounts"))
      db.update("DELETE FROM " + table + " WHERE user_id=?", user);
    db.update("DELETE FROM users WHERE id=?", user);
    accounts.cookie(res, "", 0);
    if (r.getSession(false) != null) r.getSession(false).invalidate();
    return Map.of("ok", true);
  }
}
