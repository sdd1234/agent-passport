package dev.passport;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/folders/{folderId}/tasks")
public class Collaboration {
  final Folders folders;
  final Auth auth;
  final JdbcTemplate db;
  final Crypto crypto;
  final Plans plans;
  final HistoryStore history;

  public Collaboration(
      Folders folders,
      Auth auth,
      JdbcTemplate db,
      Crypto crypto,
      Plans plans,
      HistoryStore history) {
    this.history = history;
    this.plans = plans;
    this.folders = folders;
    this.auth = auth;
    this.db = db;
    this.crypto = crypto;
  }

  record Create(
      @NotBlank @Size(max = 200) String title,
      @NotNull @Size(max = 8000) String description,
      @NotNull @Size(max = 500) String workScope) {}

  record Change(
      @NotNull @Pattern(regexp = "claim|update|release") String action,
      @Min(1) int revision,
      @Pattern(regexp = "active|blocked|done") String status,
      @Size(max = 8000) String progress) {}

  static List<Map<String, Object>> readTasks(JdbcTemplate db, Crypto crypto, String folder) {
    var rows =
        db.queryForList(
            "SELECT * FROM folder_tasks WHERE folder_id=? ORDER BY updated_at DESC", folder);
    for (var t : rows) {
      t.put("description", crypto.decrypt(t.get("description").toString()));
      t.put("progress", crypto.decrypt(t.get("progress").toString()));
      t.put(
          "lease_expired",
          "active".equals(t.get("status"))
              && ((Number) t.get("lease_until")).longValue() <= System.currentTimeMillis());
    }
    return rows;
  }

  @GetMapping
  Object list(HttpServletRequest r, @PathVariable String folderId) {
    folders.identityAccess(r, folderId, false);
    return readTasks(db, crypto, folderId);
  }

  void lock(HttpServletRequest r, String folder) {
    auth.origin(r);
    folders.identityAccess(r, folder, false);
    var access = folders.identityAccess(r, folder, true);
    plans.lock(access.get("owner_id").toString());
    db.queryForList("SELECT id FROM workspace_folders WHERE id=? FOR UPDATE", folder);
    folders.identityAccess(r, folder, true);
  }

  @PostMapping
  @Transactional
  Object create(HttpServletRequest r, @PathVariable String folderId, @Valid @RequestBody Create b) {
    lock(r, folderId);
    if (db.queryForObject(
            "SELECT COUNT(*) FROM folder_tasks WHERE folder_id=?", Integer.class, folderId)
        >= 200) throw Auth.error(409, "TASK_LIMIT_200");
    String scope =
        b.workScope().trim().replace('\\', '/').replaceAll("/+", "/").replaceAll("/$", "");
    if (scope.startsWith("/")
        || scope.contains(":")
        || Arrays.asList(scope.split("/")).contains(".."))
      throw Auth.error(400, "USE_RELATIVE_WORK_SCOPE");
    scope =
        String.join(
            "/",
            Arrays.stream(scope.split("/")).filter(v -> !v.isEmpty() && !v.equals(".")).toList());
    String id = UUID.randomUUID().toString();
    db.update(
        "INSERT INTO folder_tasks VALUES(?,?,?,?,?,'todo','','',?,0,1,?)",
        id,
        folderId,
        b.title().trim(),
        crypto.encrypt(b.description()),
        scope,
        crypto.encrypt(""),
        System.currentTimeMillis());
    var who = auth.identity(r);
    history.record(
        folderId,
        "task",
        id,
        "CREATE",
        who.ownerSession() ? who.owner() : "agent:" + who.agent(),
        null);
    plans.enforce(folders.identityAccess(r, folderId, true).get("owner_id").toString());
    return Map.of("id", id);
  }

  @PatchMapping("/{id}")
  @Transactional
  Object change(
      HttpServletRequest r,
      @PathVariable String folderId,
      @PathVariable String id,
      @Valid @RequestBody Change b) {
    lock(r, folderId);
    var who = auth.identity(r);
    String actor = who.ownerSession() ? "user:" + who.owner() : "agent:" + who.agent();
    var rows =
        db.queryForList("SELECT * FROM folder_tasks WHERE id=? AND folder_id=?", id, folderId);
    if (rows.isEmpty()) throw Auth.error(404, "TASK_NOT_FOUND");
    var task = rows.getFirst();
    if (((Number) task.get("revision")).intValue() != b.revision())
      throw Auth.error(409, "TASK_VERSION_CONFLICT");
    long now = System.currentTimeMillis();
    String status = task.get("status").toString(),
        assigned = task.get("actor").toString(),
        name = task.get("actor_name").toString();
    long lease = ((Number) task.get("lease_until")).longValue();
    String progress = task.get("progress").toString();
    if (b.action().equals("claim")) {
      if (status.equals("done")) throw Auth.error(409, "TASK_ALREADY_DONE");
      if (status.equals("active") && lease > now && !assigned.equals(actor))
        throw Auth.error(409, "TASK_ALREADY_CLAIMED");
      String scope = task.get("work_scope").toString();
      for (var other :
          db.queryForList(
              "SELECT id,work_scope FROM folder_tasks WHERE folder_id=? AND status='active' AND"
                  + " lease_until>? AND id<>?",
              folderId,
              now,
              id)) {
        String s = other.get("work_scope").toString();
        if (scope.isEmpty()
            || s.isEmpty()
            || s.equalsIgnoreCase(scope)
            || s.toLowerCase(Locale.ROOT).startsWith(scope.toLowerCase(Locale.ROOT) + "/")
            || scope.toLowerCase(Locale.ROOT).startsWith(s.toLowerCase(Locale.ROOT) + "/"))
          throw Auth.error(409, "WORK_SCOPE_BUSY");
      }
      assigned = actor;
      name =
          who.ownerSession()
              ? "사용자"
              : db.queryForObject("SELECT name FROM agents WHERE id=?", String.class, who.agent());
      status = "active";
      lease = now + 30 * 60 * 1000;
    } else {
      if (!assigned.equals(actor) && !who.ownerSession())
        throw Auth.error(403, "TASK_NOT_ASSIGNEE");
      if (!who.ownerSession() && (!status.equals("active") || lease <= now))
        throw Auth.error(409, "TASK_LEASE_EXPIRED");
      if (b.action().equals("release")) {
        status = "todo";
        assigned = "";
        name = "";
        lease = 0;
      } else {
        if (b.status() == null || b.progress() == null)
          throw Auth.error(400, "TASK_UPDATE_REQUIRED");
        if (!status.equals("active") || lease <= now) throw Auth.error(409, "CLAIM_TASK_FIRST");
        status = b.status();
        progress = crypto.encrypt(b.progress());
        lease = status.equals("active") ? now + 30 * 60 * 1000 : 0;
      }
    }
    db.update(
        "UPDATE folder_tasks SET"
            + " status=?,actor=?,actor_name=?,progress=?,lease_until=?,revision=revision+1,updated_at=?"
            + " WHERE id=?",
        status,
        assigned,
        name,
        progress,
        lease,
        now,
        id);
    db.update(
        "INSERT INTO folder_task_events VALUES(?,?,?,?,?,?)",
        UUID.randomUUID().toString(),
        id,
        actor,
        status,
        progress,
        now);
    history.record(
        folderId,
        "task",
        id,
        b.action().toUpperCase(Locale.ROOT),
        who.ownerSession() ? who.owner() : "agent:" + who.agent(),
        task);
    if (!b.action().equals("release"))
      plans.enforce(folders.identityAccess(r, folderId, true).get("owner_id").toString());
    return readTasks(db, crypto, folderId).stream()
        .filter(t -> id.equals(t.get("id")))
        .findFirst()
        .orElseThrow();
  }

  @GetMapping("/{id}/events")
  Object events(
      HttpServletRequest r,
      @PathVariable String folderId,
      @PathVariable String id,
      @RequestParam(defaultValue = "0") int offset) {
    folders.identityAccess(r, folderId, false);
    if (offset < 0) throw Auth.error(400, "INVALID_OFFSET");
    var rows =
        db.queryForList(
            "SELECT ev.* FROM folder_task_events ev JOIN folder_tasks t ON t.id=ev.task_id WHERE"
                + " t.folder_id=? AND t.id=? ORDER BY ev.created_at DESC,ev.id LIMIT 100 OFFSET ?",
            folderId,
            id,
            offset);
    for (var e : rows) e.put("progress", crypto.decrypt(e.get("progress").toString()));
    return rows;
  }

  @DeleteMapping("/{id}")
  @Transactional
  Object remove(HttpServletRequest r, @PathVariable String folderId, @PathVariable String id) {
    auth.user(r);
    lock(r, folderId);
    var before = history.archive("task", id);
    if (db.update(
            "DELETE FROM folder_tasks WHERE folder_id=? AND id=? AND status IN ('done','todo')",
            folderId,
            id)
        != 1) throw Auth.error(409, "RELEASE_TASK_FIRST");
    history.record(folderId, "task", id, "DELETE", auth.user(r), before);
    plans.enforce(folders.identityAccess(r, folderId, true).get("owner_id").toString());
    return Map.of("ok", true);
  }

  static List<Map<String, Object>> exportEvents(JdbcTemplate db, Crypto crypto, String folder) {
    var rows =
        db.queryForList(
            "SELECT ev.* FROM folder_task_events ev JOIN folder_tasks t ON ev.task_id=t.id WHERE"
                + " t.folder_id=? ORDER BY ev.created_at",
            folder);
    for (var e : rows) e.put("progress", crypto.decrypt(e.get("progress").toString()));
    return rows;
  }

  static List<Map<String, Object>> briefTasks(JdbcTemplate db, Crypto crypto, String folder) {
    return readTasks(db, crypto, folder).stream()
        .limit(20)
        .map(
            t -> {
              String p = t.get("progress").toString();
              t.put("progress", p.substring(0, Math.min(800, p.length())));
              t.remove("description");
              return t;
            })
        .toList();
  }
}
