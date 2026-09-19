package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.*;

@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:folderhistory;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
    })
@AutoConfigureMockMvc
class FolderHistoryIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired Auth auth;
  @Autowired JdbcTemplate db;
  MockHttpSession owner, editor, viewer;
  String folder;

  MockHttpSession user() {
    var s = new MockHttpSession();
    String id = UUID.randomUUID().toString();
    auth.ensureUser(id);
    s.setAttribute("owner", id);
    return s;
  }

  String uid(MockHttpSession s) {
    return s.getAttribute("owner").toString();
  }

  JsonNode postIt(String url, Object body, MockHttpSession s) throws Exception {
    return json.readTree(
        mvc.perform(
                post(url)
                    .session(s)
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(json.writeValueAsBytes(body)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  JsonNode read(String url, MockHttpSession s) throws Exception {
    return json.readTree(
        mvc.perform(get(url).session(s))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  @BeforeEach
  void setup() throws Exception {
    owner = user();
    editor = user();
    viewer = user();
    folder =
        postIt(
                "/api/folders",
                Map.of("name", "Original project", "projectPath", "/private/machine"),
                owner)
            .path("id")
            .asText();
    db.update("INSERT INTO folder_members VALUES(?,?,?)", folder, uid(editor), "editor");
    db.update("INSERT INTO folder_members VALUES(?,?,?)", folder, uid(viewer), "viewer");
  }

  String entry() throws Exception {
    return postIt(
            "/api/folders/" + folder + "/entries",
            Map.of(
                "title",
                "Original",
                "content",
                "Original secret context",
                "source",
                "/private/.claude/memory.md",
                "kind",
                "memory",
                "sourceKey",
                UUID.randomUUID().toString()),
            owner)
        .path("id")
        .asText();
  }

  void edit(String id, int version, MockHttpSession who, String content) throws Exception {
    mvc.perform(
            patch("/api/folders/" + folder + "/entries/" + id)
                .session(who)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsBytes(
                        Map.of("title", "Changed", "content", content, "revision", version))))
        .andExpect(status().isOk());
  }

  String event(String entity, String action) {
    return db.queryForList(
            "SELECT id FROM folder_history WHERE folder_id=? AND entity_id=? AND action=? ORDER BY"
                + " sequence DESC",
            folder,
            entity,
            action)
        .getFirst()
        .get("id")
        .toString();
  }

  Map<String, Object> restoreBody(String id, String side, MockHttpSession who) throws Exception {
    var d = read("/api/folders/" + folder + "/history/" + id, who);
    return Map.of(
        "side",
        side,
        "expectedRevision",
        d.path("expectedRevision").asInt(),
        "expectedHead",
        d.path("expectedHead").asLong());
  }

  void restore(String id, String side, MockHttpSession who) throws Exception {
    postIt(
        "/api/folders/" + folder + "/history/" + id + "/restore", restoreBody(id, side, who), who);
  }

  @Test
  void collaboratorsEditsAreAttributedEncryptedAndRestorableWithConflictChecks() throws Exception {
    String id = entry();
    edit(id, 1, editor, "Editor changed secret");
    String e = event(id, "EDIT");
    assertEquals(
        uid(editor),
        db.queryForObject("SELECT actor_id FROM folder_history WHERE id=?", String.class, e));
    assertFalse(
        db.queryForObject("SELECT before_state FROM folder_history WHERE id=?", String.class, e)
            .contains("Original secret"));
    var d = read("/api/folders/" + folder + "/history/" + e, viewer);
    assertEquals("Original secret context", d.path("before").path("content").asText());
    assertFalse(d.path("canRestore").asBoolean());
    assertFalse(d.toString().contains("/private"));
    var body = restoreBody(e, "before", owner);
    mvc.perform(
            post("/api/folders/" + folder + "/history/" + e + "/restore")
                .session(viewer)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(body)))
        .andExpect(status().isForbidden());
    postIt("/api/folders/" + folder + "/history/" + e + "/restore", body, owner);
    assertEquals(
        "Original secret context",
        read("/api/folders/" + folder + "/entries", owner).get(0).path("content").asText());
    assertEquals(
        3, db.queryForObject("SELECT revision FROM folder_entries WHERE id=?", Integer.class, id));
    mvc.perform(
            post("/api/folders/" + folder + "/history/" + e + "/restore")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(body)))
        .andExpect(status().isConflict());
    assertNotNull(event(id, "RESTORE"));
    db.update("DELETE FROM folder_members WHERE folder_id=? AND user_id=?", folder, uid(editor));
    mvc.perform(get("/api/folders/" + folder + "/history/" + e).session(editor))
        .andExpect(status().isForbidden());
  }

  @Test
  void deletionKeepsHistoryAndRestoresOriginalIdAndOlderVersions() throws Exception {
    String id = entry();
    edit(id, 1, editor, "Edited body");
    mvc.perform(
            delete("/api/folders/" + folder + "/entries/" + id)
                .param("revision", "2")
                .session(editor)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    assertEquals(
        0, db.queryForObject("SELECT COUNT(*) FROM folder_entries WHERE id=?", Integer.class, id));
    restore(event(id, "DELETE"), "before", owner);
    assertEquals(
        4, db.queryForObject("SELECT revision FROM folder_entries WHERE id=?", Integer.class, id));
    var versions = read("/api/folders/" + folder + "/entries/" + id + "/versions", owner);
    assertEquals(3, versions.size());
    assertEquals("Original secret context", versions.get(2).path("content").asText());
    restore(event(id, "RESTORE"), "before", owner);
    assertEquals(
        0, db.queryForObject("SELECT COUNT(*) FROM folder_entries WHERE id=?", Integer.class, id));
  }

  @Test
  void folderRestoreKeepsCurrentSharingAndPrivateMachineBindings() throws Exception {
    mvc.perform(
            patch("/api/folders/" + folder)
                .session(editor)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsBytes(
                        Map.of(
                            "name",
                            "Renamed",
                            "handoff",
                            "Changed handoff",
                            "projectPath",
                            "/attacker",
                            "revision",
                            1))))
        .andExpect(status().isOk());
    String e = event(folder, "EDIT");
    db.update(
        "UPDATE folder_members SET role='viewer' WHERE folder_id=? AND user_id=?",
        folder,
        uid(editor));
    restore(e, "before", owner);
    var f = read("/api/folders/" + folder, owner);
    assertEquals("Original project", f.path("name").asText());
    assertEquals("/private/machine", f.path("project_path").asText());
    assertEquals(
        "viewer",
        db.queryForObject(
            "SELECT role FROM folder_members WHERE folder_id=? AND user_id=?",
            String.class,
            folder,
            uid(editor)));
  }

  @Test
  void moveRestoreRequiresAccessToBothFoldersAndPreservesVersions() throws Exception {
    String id = entry(),
        destination =
            postIt("/api/folders", Map.of("name", "Private destination", "projectPath", ""), owner)
                .path("id")
                .asText();
    postIt(
        "/api/folders/" + folder + "/entries/" + id + "/move",
        Map.of("folderId", destination, "revision", 1),
        owner);
    String e = event(id, "MOVE");
    var b = restoreBody(e, "before", editor);
    mvc.perform(
            post("/api/folders/" + folder + "/history/" + e + "/restore")
                .session(editor)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(b)))
        .andExpect(status().isForbidden());
    restore(e, "before", owner);
    assertEquals(
        folder,
        db.queryForObject("SELECT folder_id FROM folder_entries WHERE id=?", String.class, id));
    assertEquals(
        3,
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_entry_versions WHERE entry_id=?", Integer.class, id));
  }

  @Test
  void taskDeletionRestoreKeepsReportsWithoutResurrectingLeases() throws Exception {
    String id =
        postIt(
                "/api/folders/" + folder + "/tasks",
                Map.of("title", "Task", "description", "description", "workScope", "web"),
                editor)
            .path("id")
            .asText();
    String path = "/api/folders/" + folder + "/tasks/" + id;
    mvc.perform(
            patch(path)
                .session(editor)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content("{\"action\":\"claim\",\"revision\":1}"))
        .andExpect(status().isOk());
    mvc.perform(
            patch(path)
                .session(editor)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    "{\"action\":\"update\",\"revision\":2,\"status\":\"done\",\"progress\":\"Completed"
                        + " report\"}"))
        .andExpect(status().isOk());
    mvc.perform(delete(path).session(editor).header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    restore(event(id, "DELETE"), "before", owner);
    var tasks = read("/api/folders/" + folder + "/tasks", owner);
    assertEquals("Completed report", tasks.get(0).path("progress").asText());
    assertEquals(0, tasks.get(0).path("lease_until").asLong());
    assertEquals("", tasks.get(0).path("actor").asText());
    assertEquals(3, read(path + "/events", owner).size());
  }

  @Test
  void exportCopyIsPrivateIndependentAndRetainsHandoffEntriesAndTasks() throws Exception {
    entry();
    postIt(
        "/api/folders/" + folder + "/tasks",
        Map.of("title", "Follow up", "description", "Keep context", "workScope", "web"),
        owner);
    var snapshot = read("/api/folders/" + folder + "/export?share=true", owner);
    assertFalse(snapshot.toString().contains("/private"));
    var copy = postIt("/api/folders/import-copy", snapshot, viewer);
    String copyId = copy.path("id").asText();
    assertNotEquals(folder, copyId);
    assertEquals("owner", copy.path("role").asText());
    assertEquals("", copy.path("project_path").asText());
    assertEquals(1, read("/api/folders/" + copyId + "/entries", viewer).size());
    assertEquals(1, read("/api/folders/" + copyId + "/tasks", viewer).size());
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_members WHERE folder_id=?", Integer.class, copyId));
    mvc.perform(get("/api/folders/" + copyId).session(owner)).andExpect(status().isForbidden());
  }

  @Test
  void restoringFromPrivateLocationDoesNotLeakPrivateIntermediateContent() throws Exception {
    String id = entry(),
        destination =
            postIt("/api/folders", Map.of("name", "Private", "projectPath", ""), owner)
                .path("id")
                .asText();
    postIt(
        "/api/folders/" + folder + "/entries/" + id + "/move",
        Map.of("folderId", destination, "revision", 1),
        owner);
    String moved = event(id, "MOVE");
    mvc.perform(
            patch("/api/folders/" + destination + "/entries/" + id)
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsBytes(
                        Map.of(
                            "title",
                            "Private edit",
                            "content",
                            "PRIVATE_INTERMEDIATE_ONLY",
                            "revision",
                            2))))
        .andExpect(status().isOk());
    restore(moved, "before", owner);
    String restored = event(id, "RESTORE");
    assertFalse(
        read("/api/folders/" + folder + "/history/" + restored, viewer)
            .toString()
            .contains("PRIVATE_INTERMEDIATE_ONLY"));
    assertFalse(
        read("/api/folders/" + folder + "/export", viewer)
            .toString()
            .contains("PRIVATE_INTERMEDIATE_ONLY"));
    assertFalse(
        read("/api/folders/" + folder + "/entries/" + id + "/versions", viewer)
            .toString()
            .contains("PRIVATE_INTERMEDIATE_ONLY"));
    assertTrue(
        read("/api/folders/" + folder + "/history/" + restored, owner)
            .toString()
            .contains("PRIVATE_INTERMEDIATE_ONLY"));
  }
}
