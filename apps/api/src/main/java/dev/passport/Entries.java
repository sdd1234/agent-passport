package dev.passport;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/folders")
public class Entries {
  final Folders folders;
  final JdbcTemplate db;
  final Crypto crypto;
  final Auth auth;
  final Plans plans;
  final ObjectMapper json;
  final MemoryService memories;

  public Entries(
      Folders folders,
      JdbcTemplate db,
      Crypto crypto,
      Auth auth,
      Plans plans,
      ObjectMapper json,
      MemoryService memories) {
    this.folders = folders;
    this.db = db;
    this.crypto = crypto;
    this.auth = auth;
    this.plans = plans;
    this.json = json;
    this.memories = memories;
  }

  record Entry(
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Size(max = 50000) String content,
      @NotNull @Size(max = 2000) String source,
      @NotNull @Pattern(regexp = "note|decision|progress|todo|session|memory") String kind,
      @Size(max = 100) String sourceKey) {}

  record Batch(@NotEmpty @Size(max = 100) List<@Valid Entry> entries) {}

  record Edit(
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Size(max = 50000) String content,
      @Min(1) int revision) {}

  record Move(@NotBlank String folderId, @Min(1) int revision) {}

  record State(boolean accept, @Min(1) int revision) {}

  String owner(HttpServletRequest r, String folder, boolean edit) {
    var f = folders.access(auth.user(r), folder, edit, false);
    String owner = f.get("owner_id").toString();
    plans.lock(owner);
    return owner;
  }

  Map<String, Object> entry(String folder, String id) {
    var rows =
        db.queryForList("SELECT * FROM folder_entries WHERE folder_id=? AND id=?", folder, id);
    if (rows.isEmpty()) throw Auth.error(404, "ENTRY_NOT_FOUND");
    return rows.getFirst();
  }

  Map<String, Object> readable(Map<String, Object> e, boolean source) {
    e.put("content", crypto.decrypt(e.get("content").toString()));
    if (e.containsKey("source"))
      e.put("source", source ? crypto.decrypt(e.get("source").toString()) : "");
    return e;
  }

  void history(String id, String title, String content, int revision, String user) {
    db.update(
        "INSERT INTO folder_entry_versions VALUES(?,?,?,?,?,?)",
        id,
        revision,
        crypto.encrypt(content),
        title,
        user,
        System.currentTimeMillis());
  }

  String insert(String folder, Entry b, String user, String state) {
    String key =
        b.sourceKey() == null || b.sourceKey().isBlank()
            ? UUID.randomUUID().toString()
            : b.sourceKey();
    var duplicate =
        db.queryForList(
            "SELECT id,title,content,kind FROM folder_entries WHERE folder_id=? AND source_key=?",
            folder,
            key);
    if (!duplicate.isEmpty()) {
      var existing = duplicate.getFirst();
      if (!existing.get("title").equals(b.title())
          || !crypto.decrypt(existing.get("content").toString()).equals(b.content())
          || !existing.get("kind").equals(b.kind())) throw Auth.error(409, "IMPORT_SOURCE_CHANGED");
      return existing.get("id").toString();
    }
    String id = UUID.randomUUID().toString();
    db.update(
        "INSERT INTO folder_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        folder,
        b.title(),
        crypto.encrypt(b.content()),
        crypto.encrypt(b.source()),
        key,
        b.kind(),
        state,
        1,
        b.content().getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
        user,
        System.currentTimeMillis());
    history(id, b.title(), b.content(), 1, user);
    return id;
  }

  @GetMapping("/{id}/entries")
  Object list(
      HttpServletRequest r,
      @PathVariable String id,
      @RequestParam(defaultValue = "") @Size(max = 2000) String query,
      @RequestParam(defaultValue = "0") int offset) {
    var f = folders.identityAccess(r, id, false);
    var who = auth.identity(r);
    boolean source = who.ownerSession() && who.owner().equals(f.get("owner_id"));
    if (query.length() > 2000 || offset < 0 || offset > 100000)
      throw Auth.error(400, "INVALID_OFFSET");
    // Decrypt only this authorized folder. Page the result and never include unreviewed entries for
    // agents.
    List<Map<String, Object>> matches = new ArrayList<>();
    int scanned = 0, skipped = 0;
    while (matches.size() < 100) {
      var rows =
          db.queryForList(
              "SELECT * FROM folder_entries WHERE folder_id=?"
                  + (who.ownerSession() ? "" : " AND state='approved'")
                  + " ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?",
              id,
              scanned);
      for (var row : rows) {
        var e = readable(row, source);
        if ((e.get("title") + " " + e.get("content"))
            .toLowerCase(Locale.ROOT)
            .contains(query.toLowerCase(Locale.ROOT))) {
          if (skipped++ >= offset) matches.add(e);
        }
        if (matches.size() == 100) break;
      }
      if (rows.size() < 100) break;
      scanned += 100;
    }
    return matches;
  }

  @PostMapping("/{id}/entries")
  @Transactional
  Object create(HttpServletRequest r, @PathVariable String id, @Valid @RequestBody Entry b) {
    auth.origin(r);
    String owner = owner(r, id, true);
    String entry = insert(id, b, auth.user(r), "approved");
    plans.enforce(owner);
    return readable(entry(id, entry), owner.equals(auth.user(r)));
  }

  @PostMapping("/{id}/import")
  @Transactional
  Object importEntries(HttpServletRequest r, @PathVariable String id, @Valid @RequestBody Batch b) {
    auth.origin(r);
    String owner = owner(r, id, true);
    List<String> ids = new ArrayList<>();
    for (var item : b.entries()) {
      String entryId = insert(id, item, auth.user(r), "approved");
      var stored = entry(id, entryId);
      if ("pending".equals(stored.get("state"))) {
        int revision = ((Number) stored.get("revision")).intValue();
        if (db.update(
                "UPDATE folder_entries SET state='approved',revision=revision+1,updated_at=? WHERE"
                    + " id=? AND revision=?",
                System.currentTimeMillis(),
                entryId,
                revision)
            != 1) throw Auth.error(409, "ENTRY_VERSION_CONFLICT");
        history(
            entryId,
            stored.get("title").toString(),
            crypto.decrypt(stored.get("content").toString()),
            revision + 1,
            auth.user(r));
      }
      ids.add(entryId);
    }
    plans.enforce(owner);
    memories.audit(owner, auth.user(r), "FOLDER_IMPORT", id, "ALLOW", null);
    return Map.of("entryIds", ids);
  }

  @PostMapping("/{id}/entries/{entryId}/review")
  @Transactional
  Object review(
      HttpServletRequest r,
      @PathVariable String id,
      @PathVariable String entryId,
      @Valid @RequestBody State b) {
    auth.origin(r);
    String owner = owner(r, id, true);
    var e = entry(id, entryId);
    if (!e.get("state").equals("pending")) throw Auth.error(409, "ENTRY_ALREADY_REVIEWED");
    if (db.update(
            "UPDATE folder_entries SET state=?,revision=revision+1,updated_at=? WHERE id=? AND"
                + " revision=?",
            b.accept() ? "approved" : "rejected",
            System.currentTimeMillis(),
            entryId,
            b.revision())
        != 1) throw Auth.error(409, "ENTRY_VERSION_CONFLICT");
    history(
        entryId,
        e.get("title").toString(),
        crypto.decrypt(e.get("content").toString()),
        b.revision() + 1,
        auth.user(r));
    plans.enforce(owner);
    return Map.of("ok", true);
  }

  @PatchMapping("/{id}/entries/{entryId}")
  @Transactional
  Object edit(
      HttpServletRequest r,
      @PathVariable String id,
      @PathVariable String entryId,
      @Valid @RequestBody Edit b) {
    auth.origin(r);
    String owner = owner(r, id, true);
    entry(id, entryId);
    if (db.update(
            "UPDATE folder_entries SET title=?,content=?,revision=revision+1,bytes=?,updated_at=?"
                + " WHERE id=? AND revision=?",
            b.title(),
            crypto.encrypt(b.content()),
            b.content().getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
            System.currentTimeMillis(),
            entryId,
            b.revision())
        != 1) throw Auth.error(409, "ENTRY_VERSION_CONFLICT");
    history(entryId, b.title(), b.content(), b.revision() + 1, auth.user(r));
    plans.enforce(owner);
    return Map.of("ok", true);
  }

  @GetMapping("/{id}/entries/{entryId}/versions")
  Object versions(HttpServletRequest r, @PathVariable String id, @PathVariable String entryId) {
    var f = folders.access(auth.user(r), id, false, false);
    entry(id, entryId);
    return db
        .queryForList(
            "SELECT * FROM folder_entry_versions WHERE entry_id=? ORDER BY revision DESC", entryId)
        .stream()
        .map(v -> readable(v, false))
        .toList();
  }

  @PostMapping("/{id}/entries/{entryId}/move")
  @Transactional
  Object move(
      HttpServletRequest r,
      @PathVariable String id,
      @PathVariable String entryId,
      @Valid @RequestBody Move b) {
    auth.origin(r);
    String user = auth.user(r);
    folders.access(user, id, true, true);
    folders.access(user, b.folderId(), true, true);
    plans.lock(user);
    entry(id, entryId);
    if (db.update(
            "UPDATE folder_entries SET folder_id=?,revision=revision+1,updated_at=? WHERE id=? AND"
                + " revision=?",
            b.folderId(),
            System.currentTimeMillis(),
            entryId,
            b.revision())
        != 1) throw Auth.error(409, "ENTRY_VERSION_CONFLICT");
    return Map.of("ok", true);
  }

  @DeleteMapping("/{id}/entries/{entryId}")
  @Transactional
  Object delete(
      HttpServletRequest r,
      @PathVariable String id,
      @PathVariable String entryId,
      @RequestParam int revision) {
    auth.origin(r);
    owner(r, id, true);
    var e = entry(id, entryId);
    if (((Number) e.get("revision")).intValue() != revision)
      throw Auth.error(409, "ENTRY_VERSION_CONFLICT");
    db.update("DELETE FROM folder_entry_versions WHERE entry_id=?", entryId);
    db.update("DELETE FROM folder_entries WHERE id=?", entryId);
    return Map.of("ok", true);
  }

  @PostMapping("/{id}/copy-memory/{memoryId}")
  @Transactional
  Object copyMemory(HttpServletRequest r, @PathVariable String id, @PathVariable String memoryId) {
    auth.origin(r);
    String owner = owner(r, id, true), user = auth.user(r);
    var m = memories.memory(user, memoryId);
    if (!m.get("status").equals("current")) throw Auth.error(400, "APPROVED_MEMORY_REQUIRED");
    String entry =
        insert(
            id,
            new Entry(
                m.get("canonical_key").toString(),
                memories.versions(user, memoryId).getFirst().get("content").toString(),
                "passport:" + memoryId + ":v" + m.get("current_version"),
                "memory",
                Crypto.hash(memoryId + ":" + m.get("current_version"))),
            user,
            "approved");
    plans.enforce(owner);
    return Map.of("id", entry);
  }

  @GetMapping("/{id}/export")
  Object export(HttpServletRequest r, @PathVariable String id) {
    String user = auth.user(r);
    var f = folders.access(user, id, false, false);
    boolean owner = user.equals(f.get("owner_id"));
    return Map.of(
        "schemaVersion",
        1,
        "folder",
        folders.readable(f),
        "entries",
        db
            .queryForList("SELECT * FROM folder_entries WHERE folder_id=? ORDER BY updated_at", id)
            .stream()
            .map(e -> readable(e, owner))
            .toList());
  }

  @PostMapping("/{id}/proposals")
  @Transactional
  Object propose(HttpServletRequest r, @PathVariable String id, @Valid @RequestBody Entry b)
      throws Exception {
    auth.origin(r);
    var f = folders.identityAccess(r, id, true);
    var who = auth.identity(r);
    String owner = f.get("owner_id").toString();
    plans.lock(owner);
    if (db.queryForObject(
            "SELECT COUNT(*) FROM folder_changes WHERE folder_id=? AND state='pending'",
            Integer.class,
            id)
        >= 100) throw Auth.error(429, "REVIEW_PENDING_CHANGES_FIRST");
    String change = UUID.randomUUID().toString();
    db.update(
        "INSERT INTO folder_changes VALUES(?,?,?,?,?,?)",
        change,
        id,
        crypto.encrypt(json.writeValueAsString(b)),
        who.agent(),
        "pending",
        System.currentTimeMillis());
    plans.enforce(owner);
    return Map.of("id", change, "state", "pending");
  }

  @GetMapping("/{id}/proposals")
  Object proposals(HttpServletRequest r, @PathVariable String id) {
    folders.access(auth.user(r), id, false, false);
    return db
        .queryForList(
            "SELECT * FROM folder_changes WHERE folder_id=? AND state='pending' ORDER BY"
                + " created_at",
            id)
        .stream()
        .map(
            p -> {
              try {
                p.put("entry", json.readTree(crypto.decrypt(p.remove("payload").toString())));
                return p;
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            })
        .toList();
  }

  record Resolve(boolean accept) {}

  @PostMapping("/{id}/proposals/{proposalId}/review")
  @Transactional
  Object resolve(
      HttpServletRequest r,
      @PathVariable String id,
      @PathVariable String proposalId,
      @RequestBody Resolve b)
      throws Exception {
    auth.origin(r);
    String owner = owner(r, id, true);
    var rows =
        db.queryForList(
            "SELECT * FROM folder_changes WHERE id=? AND folder_id=? AND state='pending'",
            proposalId,
            id);
    if (rows.isEmpty()) throw Auth.error(409, "PROPOSAL_ALREADY_REVIEWED");
    var p = rows.getFirst();
    if (b.accept()) {
      var item = json.readValue(crypto.decrypt(p.get("payload").toString()), Entry.class);
      insert(
          id,
          new Entry(
              item.title(),
              item.content(),
              "agent:" + p.get("agent_id"),
              item.kind(),
              "proposal:" + proposalId),
          auth.user(r),
          "approved");
    }
    db.update("DELETE FROM folder_changes WHERE id=?", proposalId);
    plans.enforce(owner);
    return Map.of("ok", true);
  }
}
