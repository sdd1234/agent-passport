package dev.passport;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/folders/{folderId}/history")
public class FolderHistory {
  final Folders folders;
  final HistoryStore history;
  final Auth auth;
  final Plans plans;
  final JdbcTemplate db;

  public FolderHistory(
      Folders folders, HistoryStore history, Auth auth, Plans plans, JdbcTemplate db) {
    this.folders = folders;
    this.history = history;
    this.auth = auth;
    this.plans = plans;
    this.db = db;
  }

  Map<String, Object> event(String folder, String id) {
    var rows =
        db.queryForList("SELECT * FROM folder_history WHERE id=? AND folder_id=?", id, folder);
    if (rows.isEmpty()) throw Auth.error(404, "HISTORY_NOT_FOUND");
    return rows.getFirst();
  }

  @GetMapping
  Object list(
      HttpServletRequest r,
      @PathVariable String folderId,
      @RequestParam(defaultValue = "0") int offset) {
    folders.access(auth.user(r), folderId, false, false);
    if (offset < 0 || offset > 100000) throw Auth.error(400, "INVALID_OFFSET");
    return db.queryForList(
        "SELECT id,sequence,entity_type,entity_id,entity_revision,action,actor_name,created_at FROM"
            + " folder_history WHERE folder_id=? ORDER BY sequence DESC LIMIT 50 OFFSET ?",
        folderId,
        offset);
  }

  @GetMapping("/{eventId}")
  Object detail(HttpServletRequest r, @PathVariable String folderId, @PathVariable String eventId) {
    var f = folders.access(auth.user(r), folderId, false, false);
    var e = event(folderId, eventId);
    String type = e.get("entity_type").toString(), id = e.get("entity_id").toString();
    var current = history.snapshot(type, id);
    boolean visible =
        current == null || type.equals("folder") || folderId.equals(current.get("folder_id"));
    boolean isOwner = f.get("role").equals("owner");
    var result = new LinkedHashMap<String, Object>();
    result.put(
        "event",
        Map.of(
            "id", eventId, "type", type, "actor", e.get("actor_name"), "action", e.get("action")));
    result.put(
        "before",
        history.previewInFolder(history.decode(e.get("before_state")), type, folderId, isOwner));
    result.put(
        "after",
        history.previewInFolder(history.decode(e.get("after_state")), type, folderId, isOwner));
    result.put("current", visible ? history.preview(current, type, isOwner) : null);
    result.put("moved", !visible);
    result.put("expectedHead", history.head(type, id));
    result.put("expectedRevision", current == null ? 0 : current.get("revision"));
    result.put(
        "canRestore",
        !f.get("role").equals("viewer") && (visible || f.get("role").equals("owner")));
    return result;
  }

  record Restore(
      @NotNull @Pattern(regexp = "before|after") String side,
      @Min(0) int expectedRevision,
      @Min(1) long expectedHead) {}

  @PostMapping("/{eventId}/restore")
  @Transactional
  Object restore(
      HttpServletRequest r,
      @PathVariable String folderId,
      @PathVariable String eventId,
      @Valid @RequestBody Restore b) {
    auth.origin(r);
    String user = auth.user(r);
    var folder = folders.access(user, folderId, true, false);
    String owner = folder.get("owner_id").toString();
    plans.lock(owner);
    folder = folders.access(user, folderId, true, false);
    var e = event(folderId, eventId);
    String type = e.get("entity_type").toString(), id = e.get("entity_id").toString();
    var current = history.snapshot(type, id);
    var target = history.decode(e.get(b.side() + "_state"));
    if (history.head(type, id) != b.expectedHead()
        || (current == null ? 0 : ((Number) current.get("revision")).intValue())
            != b.expectedRevision()) throw Auth.error(409, "HISTORY_VERSION_CONFLICT");
    if (type.equals("folder") && target == null) throw Auth.error(400, "USE_FOLDER_DELETE");
    if (current == null && target == null) throw Auth.error(409, "ALREADY_DELETED");
    int revision = history.nextRevision(type, id, current);
    long now = System.currentTimeMillis();
    var before = history.archive(type, id);
    if (type.equals("entry")) restoreEntry(user, folderId, id, current, target, revision, now);
    else if (type.equals("folder")) restoreFolder(user, folderId, current, target, revision, now);
    else if (type.equals("task")) restoreTask(user, folderId, id, current, target, revision, now);
    else throw Auth.error(400, "INVALID_HISTORY_TYPE");
    history.record(folderId, type, id, "RESTORE", user, before);
    if (!type.equals("folder")) {
      var after = history.snapshot(type, id);
      Set<String> other = new HashSet<>();
      if (current != null) other.add(current.get("folder_id").toString());
      if (after != null) other.add(after.get("folder_id").toString());
      other.remove(folderId);
      for (String f : other) history.recordStates(f, type, id, "RESTORE", user, before, after);
    }
    plans.enforce(owner);
    return Map.of("ok", true);
  }

  void restoreEntry(
      String user,
      String folder,
      String id,
      Map<String, Object> current,
      Map<String, Object> target,
      int version,
      long now) {
    if (current != null && !folder.equals(current.get("folder_id")))
      folders.access(user, current.get("folder_id").toString(), true, true);
    if (target != null && !folder.equals(target.get("folder_id")))
      folders.access(user, target.get("folder_id").toString(), true, true);
    if ((current != null && !folder.equals(current.get("folder_id")))
        || (target != null && !folder.equals(target.get("folder_id"))))
      folders.access(user, folder, true, true);
    if (target == null) {
      db.update("DELETE FROM folder_entry_versions WHERE entry_id=?", id);
      db.update("DELETE FROM folder_entries WHERE id=?", id);
      return;
    }
    String dest = target.get("folder_id").toString();
    if (db.queryForObject(
            "SELECT COUNT(*) FROM folder_entries WHERE folder_id=? AND source_key=? AND id<>?",
            Integer.class,
            dest,
            target.get("source_key"),
            id)
        > 0) throw Auth.error(409, "RESTORE_SOURCE_CONFLICT");
    if (current == null) {
      db.update(
          "INSERT INTO folder_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          dest,
          target.get("title"),
          target.get("content"),
          target.get("source"),
          target.get("source_key"),
          target.get("kind"),
          target.get("state"),
          version,
          target.get("bytes"),
          target.get("created_by"),
          now);
      if (target.get("_versions") instanceof List<?> versions)
        for (Object raw : versions) {
          var v = (Map<?, ?>) raw;
          db.update(
              "INSERT INTO"
                  + " folder_entry_versions(entry_id,revision,content,title,created_by,updated_at,folder_id)"
                  + " VALUES(?,?,?,?,?,?,?)",
              id,
              v.get("revision"),
              v.get("content"),
              v.get("title"),
              v.get("created_by"),
              v.get("updated_at"),
              v.get("folder_id") == null ? dest : v.get("folder_id"));
        }
    } else
      db.update(
          "UPDATE folder_entries SET"
              + " folder_id=?,title=?,content=?,source=?,source_key=?,kind=?,state=?,revision=?,bytes=?,updated_at=?"
              + " WHERE id=?",
          dest,
          target.get("title"),
          target.get("content"),
          target.get("source"),
          target.get("source_key"),
          target.get("kind"),
          target.get("state"),
          version,
          target.get("bytes"),
          now,
          id);
    db.update(
        "INSERT INTO"
            + " folder_entry_versions(entry_id,revision,content,title,created_by,updated_at,folder_id)"
            + " VALUES(?,?,?,?,?,?,?)",
        id,
        version,
        target.get("content"),
        target.get("title"),
        user,
        now,
        dest);
  }

  void restoreFolder(
      String user,
      String id,
      Map<String, Object> current,
      Map<String, Object> target,
      int revision,
      long now) {
    Object parent = current.get("parent_id");
    if (user.equals(current.get("owner_id"))) {
      parent = target.get("parent_id");
      String cursor = (String) parent;
      Set<String> seen = new HashSet<>();
      while (cursor != null) {
        if (cursor.equals(id) || !seen.add(cursor)) throw Auth.error(409, "FOLDER_CYCLE");
        var f = folders.access(user, cursor, true, true);
        cursor = (String) f.get("parent_id");
      }
    }
    // Sharing, machine paths and agent grants are never rewound with project content.
    db.update(
        "UPDATE workspace_folders SET name=?,handoff=?,parent_id=?,revision=?,updated_at=? WHERE"
            + " id=?",
        target.get("name"),
        target.get("handoff"),
        parent,
        revision,
        now,
        id);
  }

  void restoreTask(
      String user,
      String folder,
      String id,
      Map<String, Object> current,
      Map<String, Object> target,
      int revision,
      long now) {
    if (current != null
        && "active".equals(current.get("status"))
        && ((Number) current.get("lease_until")).longValue() > now)
      throw Auth.error(409, "RELEASE_TASK_FIRST");
    if (target == null) {
      db.update("DELETE FROM folder_tasks WHERE id=?", id);
      return;
    }
    String state = "active".equals(target.get("status")) ? "todo" : target.get("status").toString();
    if (current == null) {
      if (db.queryForObject(
              "SELECT COUNT(*) FROM folder_tasks WHERE folder_id=?", Integer.class, folder)
          >= 200) throw Auth.error(409, "TASK_LIMIT_200");
      db.update(
          "INSERT INTO folder_tasks VALUES(?,?,?,?,?,?,?, ?,?,0,?,?)",
          id,
          folder,
          target.get("title"),
          target.get("description"),
          target.get("work_scope"),
          state,
          "",
          "",
          target.get("progress"),
          revision,
          now);
      if (target.get("_events") instanceof List<?> events)
        for (Object raw : events) {
          var v = (Map<?, ?>) raw;
          db.update(
              "INSERT INTO folder_task_events VALUES(?,?,?,?,?,?)",
              v.get("id"),
              id,
              v.get("actor"),
              v.get("status"),
              v.get("progress"),
              v.get("created_at"));
        }
    } else
      db.update(
          "UPDATE folder_tasks SET"
              + " title=?,description=?,work_scope=?,status=?,actor='',actor_name='',progress=?,lease_until=0,revision=?,updated_at=?"
              + " WHERE id=?",
          target.get("title"),
          target.get("description"),
          target.get("work_scope"),
          state,
          target.get("progress"),
          revision,
          now,
          id);
    db.update(
        "INSERT INTO folder_task_events VALUES(?,?,?,?,?,?)",
        UUID.randomUUID().toString(),
        id,
        "user:" + user,
        state,
        target.get("progress"),
        now);
  }
}
