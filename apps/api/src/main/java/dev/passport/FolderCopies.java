package dev.passport;

import com.fasterxml.jackson.annotation.JsonProperty;
import dev.passport.Entries.Entry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/folders/import-copy")
public class FolderCopies {
  final Folders folders;
  final Entries entries;
  final Collaboration tasks;
  final HistoryStore history;
  final Auth auth;
  final Crypto crypto;
  final JdbcTemplate db;
  final Plans plans;

  public FolderCopies(
      Folders folders,
      Entries entries,
      Collaboration tasks,
      HistoryStore history,
      Auth auth,
      Crypto crypto,
      JdbcTemplate db,
      Plans plans) {
    this.folders = folders;
    this.entries = entries;
    this.tasks = tasks;
    this.history = history;
    this.auth = auth;
    this.crypto = crypto;
    this.db = db;
    this.plans = plans;
  }

  record Folder(
      @NotBlank @Size(max = 120) String name, @NotNull @Size(max = 50000) String handoff) {}

  record Task(
      @NotBlank @Size(max = 200) String title,
      @NotNull @Size(max = 8000) String description,
      @JsonProperty("work_scope") @NotNull @Size(max = 500) String scope,
      @NotNull @Pattern(regexp = "todo|active|blocked|done") String status,
      @NotNull @Size(max = 8000) String progress) {}

  record Copy(
      @Min(1) @Max(1) int schemaVersion,
      @NotNull @Valid Folder folder,
      @NotNull @Size(max = 1000) List<@NotNull @Valid Entry> entries,
      @Size(max = 200) List<@NotNull @Valid Task> tasks) {}

  @PostMapping
  @Transactional
  Object copy(HttpServletRequest r, @Valid @RequestBody Copy body) {
    auth.origin(r);
    String user = auth.user(r);
    plans.lock(user);
    var created = (Map<?, ?>) folders.create(r, new Folders.Create(body.folder().name(), "", null));
    String id = created.get("id").toString();
    if (!body.folder().handoff().isBlank())
      folders.edit(r, id, new Folders.Edit(body.folder().name(), "", body.folder().handoff(), 1));
    for (var e : body.entries()) {
      String provider =
          e.source().contains("/.claude/")
              ? "claude"
              : e.source().contains("/.codex/") ? "codex" : "unknown";
      entries.insert(
          id,
          new Entries.Entry(
              e.title(), e.content(), "passport-copy:/." + provider + "/", e.kind(), null),
          user,
          "approved");
    }
    if (body.tasks() != null)
      for (var t : body.tasks()) {
        var task =
            (Map<?, ?>)
                tasks.create(
                    r, id, new Collaboration.Create(t.title(), t.description(), t.scope()));
        String taskId = task.get("id").toString();
        var before = history.snapshot("task", taskId);
        db.update(
            "UPDATE folder_tasks SET status=?,progress=?,revision=revision+1 WHERE id=?",
            "active".equals(t.status()) ? "todo" : t.status(),
            crypto.encrypt(t.progress()),
            taskId);
        history.record(id, "task", taskId, "COPY", user, before);
      }
    plans.enforce(user);
    return folders.get(r, id);
  }
}
