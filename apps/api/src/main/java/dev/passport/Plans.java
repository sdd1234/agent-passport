package dev.passport;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class Plans {
  @org.springframework.beans.factory.annotation.Value(
      "${passport.billing.price-id:${STRIPE_PRICE_ID:disabled}}")
  String paidPrice;

  final JdbcTemplate db;

  public Plans(JdbcTemplate db) {
    this.db = db;
  }

  public void lock(String owner) {
    db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", owner);
  }

  public boolean paid(String owner) {
    return db.queryForObject(
            "SELECT COUNT(*) FROM subscriptions WHERE user_id=? AND status IN ('active','trialing')"
                + " AND price_id=? AND updated_at>?",
            Integer.class,
            owner,
            paidPrice,
            System.currentTimeMillis() - 259200000L)
        > 0;
  }

  long limit(boolean paid, String key, long free, long pro) {
    return Long.parseLong(
        Config.env((paid ? "PRO_" : "FREE_") + key, Long.toString(paid ? pro : free)));
  }

  public Map<String, Object> usage(String owner) {
    boolean paid = paid(owner);
    long folders =
        db.queryForObject(
            "SELECT COUNT(*) FROM workspace_folders WHERE owner_id=?", Long.class, owner);
    long entries =
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_entries e JOIN workspace_folders f ON e.folder_id=f.id"
                + " WHERE f.owner_id=?",
            Long.class,
            owner);
    long bytes =
        db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(e.content)+OCTET_LENGTH(e.source)),0) FROM"
                    + " folder_entries e JOIN workspace_folders f ON e.folder_id=f.id WHERE"
                    + " f.owner_id=?",
                Long.class,
                owner)
            + db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(v.content)),0) FROM folder_entry_versions v JOIN"
                    + " folder_entries e ON v.entry_id=e.id JOIN workspace_folders f ON"
                    + " e.folder_id=f.id WHERE f.owner_id=?",
                Long.class,
                owner)
            + db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(handoff)),0) FROM workspace_folders WHERE"
                    + " owner_id=?",
                Long.class,
                owner);
    bytes +=
        db.queryForObject(
            "SELECT COALESCE(SUM(OCTET_LENGTH(c.payload)),0) FROM folder_changes c JOIN"
                + " workspace_folders f ON c.folder_id=f.id WHERE f.owner_id=?",
            Long.class,
            owner);
    bytes +=
        db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(v.content)),0) FROM versions v JOIN memories m ON"
                    + " v.memory_id=m.id WHERE m.owner_id=?",
                Long.class,
                owner)
            + db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(payload)),0) FROM proposals WHERE owner_id=?",
                Long.class,
                owner);
    bytes +=
        db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(t.description)+OCTET_LENGTH(t.progress)),0) FROM"
                    + " folder_tasks t JOIN workspace_folders f ON t.folder_id=f.id WHERE"
                    + " f.owner_id=?",
                Long.class,
                owner)
            + db.queryForObject(
                "SELECT COALESCE(SUM(OCTET_LENGTH(ev.progress)),0) FROM folder_task_events ev JOIN"
                    + " folder_tasks t ON ev.task_id=t.id JOIN workspace_folders f ON"
                    + " t.folder_id=f.id WHERE f.owner_id=?",
                Long.class,
                owner);
    entries +=
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_tasks t JOIN workspace_folders f ON t.folder_id=f.id WHERE"
                + " f.owner_id=?",
            Long.class,
            owner);
    entries +=
        db.queryForObject("SELECT COUNT(*) FROM memories WHERE owner_id=?", Long.class, owner);
    bytes +=
        db.queryForObject(
            "SELECT COALESCE(SUM(OCTET_LENGTH(h.before_state)+OCTET_LENGTH(h.after_state)),0) FROM"
                + " folder_history h JOIN workspace_folders f ON h.folder_id=f.id WHERE"
                + " f.owner_id=?",
            Long.class,
            owner);
    long shares =
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_members m JOIN workspace_folders f ON m.folder_id=f.id"
                + " WHERE f.owner_id=?",
            Long.class,
            owner);
    return Map.of(
        "plan",
        paid ? "pro" : "free",
        "folders",
        folders,
        "entries",
        entries,
        "storedBytes",
        bytes,
        "shares",
        shares,
        "limits",
        Map.of(
            "folders",
            limit(paid, "FOLDERS", 20, 1000),
            "entries",
            limit(paid, "ENTRIES", 500, 50000),
            "storedBytes",
            limit(paid, "STORAGE_BYTES", 10485760, 1073741824),
            "shares",
            limit(paid, "SHARES", 10, 1000)));
  }

  public void enforce(String owner) {
    var u = usage(owner);
    var limits = (Map<?, ?>) u.get("limits");
    for (String key : List.of("folders", "entries", "storedBytes", "shares"))
      if (((Number) u.get(key)).longValue() > ((Number) limits.get(key)).longValue())
        throw Auth.error(402, "PLAN_LIMIT_" + key.toUpperCase(Locale.ROOT));
  }
}
