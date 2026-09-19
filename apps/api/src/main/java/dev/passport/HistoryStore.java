package dev.passport;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class HistoryStore {
  final JdbcTemplate db;
  final Crypto crypto;
  final ObjectMapper json;

  public HistoryStore(JdbcTemplate db, Crypto crypto, ObjectMapper json) {
    this.db = db;
    this.crypto = crypto;
    this.json = json;
  }

  public Map<String, Object> snapshot(String type, String id) {
    String table =
        switch (type) {
          case "entry" -> "folder_entries";
          case "folder" -> "workspace_folders";
          case "task" -> "folder_tasks";
          default -> throw new IllegalArgumentException();
        };
    var rows = db.queryForList("SELECT * FROM " + table + " WHERE id=?", id);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  public Map<String, Object> archive(String type, String id) {
    var s = snapshot(type, id);
    if (s != null && type.equals("entry"))
      s.put(
          "_versions",
          db.queryForList(
              "SELECT * FROM folder_entry_versions WHERE entry_id=? ORDER BY revision", id));
    if (s != null && type.equals("task"))
      s.put(
          "_events",
          db.queryForList(
              "SELECT * FROM folder_task_events WHERE task_id=? ORDER BY created_at", id));
    return s;
  }

  public Map<String, Object> decode(Object value) {
    try {
      return json.readValue(
          crypto.decrypt(value.toString()), new TypeReference<Map<String, Object>>() {});
    } catch (Exception e) {
      throw new IllegalStateException("History cannot be decoded", e);
    }
  }

  String encode(Map<String, Object> state) {
    try {
      return crypto.encrypt(json.writeValueAsString(state));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  int revision(Map<String, Object> s) {
    return s == null ? 0 : ((Number) s.get("revision")).intValue();
  }

  public void record(
      String folder,
      String type,
      String id,
      String action,
      String actor,
      Map<String, Object> before) {
    recordStates(folder, type, id, action, actor, before, snapshot(type, id));
  }

  public void recordStates(
      String folder,
      String type,
      String id,
      String action,
      String actor,
      Map<String, Object> before,
      Map<String, Object> after) {
    var names =
        actor.startsWith("agent:")
            ? db.queryForList("SELECT name AS name FROM agents WHERE id=?", actor.substring(6))
            : db.queryForList("SELECT username AS name FROM accounts WHERE user_id=?", actor);
    String name =
        names.isEmpty()
            ? (actor.startsWith("agent:") ? "에이전트" : "사용자")
            : names.getFirst().get("name").toString();
    int version = Math.max(revision(before), revision(after)) + (after == null ? 1 : 0);
    db.update(
        "INSERT INTO"
            + " folder_history(id,folder_id,entity_type,entity_id,entity_revision,action,actor_id,actor_name,before_state,after_state,created_at)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        UUID.randomUUID().toString(),
        folder,
        type,
        id,
        version,
        action,
        actor,
        name,
        encode(before),
        encode(after),
        System.currentTimeMillis());
  }

  public long head(String type, String id) {
    return db.queryForObject(
        "SELECT COALESCE(MAX(sequence),0) FROM folder_history WHERE entity_type=? AND entity_id=?",
        Long.class,
        type,
        id);
  }

  public int nextRevision(String type, String id, Map<String, Object> current) {
    int last =
        db.queryForObject(
            "SELECT COALESCE(MAX(entity_revision),0) FROM folder_history WHERE entity_type=? AND"
                + " entity_id=?",
            Integer.class,
            type,
            id);
    return Math.max(last, revision(current)) + 1;
  }

  public Map<String, Object> preview(Map<String, Object> state, String type, boolean owner) {
    if (state == null) return null;
    var result = new LinkedHashMap<String, Object>();
    var fields =
        switch (type) {
          case "entry" -> List.of("title", "content", "kind", "state", "revision");
          case "folder" -> List.of("name", "handoff", "revision");
          default ->
              List.of("title", "description", "progress", "work_scope", "status", "revision");
        };
    for (String field : fields)
      if (state.containsKey(field))
        result.put(
            field,
            Set.of("content", "handoff", "description", "progress").contains(field)
                ? crypto.decrypt(state.get(field).toString())
                : state.get(field));
    if (owner && (type.equals("entry") || type.equals("folder"))) {
      Object location = state.get(type.equals("entry") ? "folder_id" : "parent_id");
      if (location == null) result.put("location", "최상위");
      else {
        var rows = db.queryForList("SELECT name FROM workspace_folders WHERE id=?", location);
        result.put("location", rows.isEmpty() ? "삭제된 폴더" : rows.getFirst().get("name"));
      }
    }
    return result;
  }

  public Map<String, Object> previewInFolder(
      Map<String, Object> state, String type, String folder, boolean owner) {
    if (!owner && state != null && !type.equals("folder") && !folder.equals(state.get("folder_id")))
      return null;
    return preview(state, type, owner);
  }

  public List<Map<String, Object>> export(String folder, boolean owner) {
    return db
        .queryForList("SELECT * FROM folder_history WHERE folder_id=? ORDER BY sequence", folder)
        .stream()
        .map(
            e -> {
              Map<String, Object> row = new LinkedHashMap<>();
              for (String key :
                  List.of(
                      "id",
                      "entity_type",
                      "entity_id",
                      "entity_revision",
                      "action",
                      "actor_name",
                      "created_at")) row.put(key, e.get(key));
              String type = e.get("entity_type").toString();
              row.put(
                  "before", previewInFolder(decode(e.get("before_state")), type, folder, owner));
              row.put("after", previewInFolder(decode(e.get("after_state")), type, folder, owner));
              return row;
            })
        .toList();
  }
}
