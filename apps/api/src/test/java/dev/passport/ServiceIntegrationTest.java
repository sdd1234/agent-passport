package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
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
      "spring.datasource.url=jdbc:h2:mem:service;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
    })
@AutoConfigureMockMvc
class ServiceIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired Auth auth;
  @Autowired JdbcTemplate db;
  @Autowired MemoryService memories;
  MockHttpSession owner, guest;
  String folder, guestId;

  MockHttpSession user() {
    var s = new MockHttpSession();
    String u = UUID.randomUUID().toString();
    auth.ensureUser(u);
    s.setAttribute("owner", u);
    return s;
  }

  JsonNode postJson(String path, Object body, MockHttpSession session) throws Exception {
    var response =
        mvc.perform(
                post(path)
                    .session(session)
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(json.writeValueAsBytes(body)))
            .andExpect(status().isOk())
            .andReturn();
    return json.readTree(response.getResponse().getContentAsString());
  }

  @BeforeEach
  void setup() throws Exception {
    owner = user();
    guest = user();
    guestId = guest.getAttribute("owner").toString();
    folder =
        postJson("/api/folders", Map.of("name", "Project", "projectPath", "/work/project"), owner)
            .path("id")
            .asText();
  }

  Map<String, Object> item(String key) {
    return Map.of(
        "title",
        "Architecture",
        "content",
        "PostgreSQL approved context",
        "kind",
        "decision",
        "source",
        "/private/session",
        "sourceKey",
        key);
  }

  @Test
  void folderProviderColorsUseVisibleSourcesWithoutExposingPaths() throws Exception {
    var claude = new HashMap<String, Object>(item("claude-source"));
    claude.put("source", "/private/.claude/projects/memory.md");
    var codex = new HashMap<String, Object>(item("codex-source"));
    codex.put("source", "C:/private/.codex/sessions/conversation.jsonl");
    postJson(
        "/api/folders/" + folder + "/import", Map.of("entries", List.of(claude, codex)), owner);
    var response =
        mvc.perform(get("/api/folders").session(owner))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertEquals(
        json.readTree("[\"claude\",\"codex\"]"), json.readTree(response).get(0).path("providers"));
    assertFalse(response.contains("/private/.claude"));
    mvc.perform(get("/api/folders").session(guest))
        .andExpect(status().isOk())
        .andExpect(content().json("[]"));
  }

  @Test
  void importingOwnPendingMemoryRequiresNoSeparateReview() throws Exception {
    var imported =
        postJson(
            "/api/folders/" + folder + "/import",
            Map.of("entries", List.of(item("ready-source"))),
            owner);
    String id = imported.path("entryIds").get(0).asText();
    db.update("UPDATE folder_entries SET state='pending' WHERE id=?", id);
    postJson(
        "/api/folders/" + folder + "/import",
        Map.of("entries", List.of(item("ready-source"))),
        owner);
    assertEquals(
        "approved",
        db.queryForObject("SELECT state FROM folder_entries WHERE id=?", String.class, id));
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_entries WHERE folder_id=?", Integer.class, folder));
  }

  @Test
  void ownerImportIsReadyWithoutReviewAndAgentChangesStillNeedApproval() throws Exception {
    var imported =
        postJson(
            "/api/folders/" + folder + "/import",
            Map.of("entries", List.of(item("source1"))),
            owner);
    String entry = imported.path("entryIds").get(0).asText();
    assertEquals(
        entry,
        postJson(
                "/api/folders/" + folder + "/import",
                Map.of("entries", List.of(item("source1"))),
                owner)
            .path("entryIds")
            .get(0)
            .asText());
    var pair = postJson("/api/pairings", Map.of("folderId", folder, "role", "editor"), owner);
    String code = pair.path("code").asText();
    postJson("/api/pairings/join", Map.of("code", code), guest);
    postJson("/api/pairings/" + pair.path("id").asText() + "/confirm", Map.of("code", code), owner);
    mvc.perform(
            post("/api/pairings/join")
                .session(guest)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("code", code))))
        .andExpect(status().isConflict());
    var a = memories.register(guestId, "mcp", "Guest Agent");
    String bearer = "Bearer " + a.get("token");
    mvc.perform(
            get("/api/folders/context").param("folderId", folder).header("Authorization", bearer))
        .andExpect(status().isForbidden());
    postJson(
        "/api/folders/" + folder + "/agent-grants",
        Map.of("agentId", a.get("id"), "bits", 3),
        guest);
    postJson("/api/folders/" + folder + "/binding", Map.of("localPath", "/guest/project"), guest);
    mvc.perform(
            get("/api/folders/context")
                .param("cwd", "/guest/project/src")
                .header("Authorization", bearer))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.entries.length()").value(1));
    mvc.perform(
            get("/api/folders/context")
                .param("cwd", "/guest/project")
                .header("Authorization", bearer))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.entries[0].content").value("PostgreSQL approved context"));
    mvc.perform(get("/api/folders/" + folder + "/entries").header("Authorization", bearer))
        .andExpect(jsonPath("$[0].source").value(""));
    var proposal =
        mvc.perform(
                post("/api/folders/" + folder + "/proposals")
                    .header("Authorization", bearer)
                    .contentType("application/json")
                    .content(json.writeValueAsBytes(item("agent1"))))
            .andExpect(status().isOk())
            .andReturn();
    String pid = json.readTree(proposal.getResponse().getContentAsString()).path("id").asText();
    mvc.perform(
            post("/api/folders/" + folder + "/proposals/" + pid + "/review")
                .header("Authorization", bearer)
                .contentType("application/json")
                .content("{\"accept\":true}"))
        .andExpect(status().isUnauthorized());
    postJson(
        "/api/folders/" + folder + "/proposals/" + pid + "/review", Map.of("accept", true), guest);
    mvc.perform(
            delete("/api/folders/" + folder + "/members/" + guestId)
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    mvc.perform(
            get("/api/folders/context").param("folderId", folder).header("Authorization", bearer))
        .andExpect(status().isForbidden());
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_agent_grants WHERE agent_id=?",
            Integer.class,
            a.get("id")));
  }

  @Test
  void folderCyclesMovesHistoryAndDeletion() throws Exception {
    String child =
        postJson(
                "/api/folders",
                Map.of("name", "Child", "projectPath", "", "parentId", folder),
                owner)
            .path("id")
            .asText();
    mvc.perform(
            post("/api/folders/" + folder + "/move")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("parentId", child, "revision", 1))))
        .andExpect(status().isBadRequest());
    String entry =
        postJson("/api/folders/" + folder + "/entries", item("move1"), owner).path("id").asText();
    postJson(
        "/api/folders/" + folder + "/entries/" + entry + "/move",
        Map.of("folderId", child, "revision", 1),
        owner);
    mvc.perform(get("/api/folders/" + folder + "/entries/" + entry + "/versions").session(owner))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/folders/" + child + "/entries/" + entry + "/versions").session(owner))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].content").value("PostgreSQL approved context"));
    mvc.perform(
            delete("/api/folders/" + folder)
                .param("revision", "1")
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isConflict());
    mvc.perform(
            delete("/api/folders/" + child)
                .param("revision", "1")
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM folder_entry_versions WHERE entry_id=?", Integer.class, entry));
  }

  @Test
  void quotasRollbackAndFreePlanNotSetByClient() throws Exception {
    String user = owner.getAttribute("owner").toString();
    for (int n = 0; n < 19; n++)
      postJson("/api/folders", Map.of("name", "folder " + n, "projectPath", ""), owner);
    mvc.perform(
            post("/api/folders")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content("{\"name\":\"over\",\"projectPath\":\"\"}"))
        .andExpect(status().isPaymentRequired());
    assertEquals(
        20,
        db.queryForObject(
            "SELECT COUNT(*) FROM workspace_folders WHERE owner_id=?", Integer.class, user));
    mvc.perform(get("/api/billing").session(owner))
        .andExpect(jsonPath("$.usage.plan").value("free"))
        .andExpect(jsonPath("$.checkoutEnabled").value(false));
    mvc.perform(
            post("/api/billing/checkout")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content("{\"plan\":\"pro\"}"))
        .andExpect(status().isServiceUnavailable());
  }

  @Test
  void accountLoginPersistentSessionRecoveryAndLogout() throws Exception {
    String username = "u" + UUID.randomUUID().toString().replace("-", "");
    Map<String, String> creds = Map.of("username", username, "password", "a-long-test-password");
    var response =
        mvc.perform(
                post("/api/account/register")
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(json.writeValueAsBytes(creds)))
            .andExpect(status().isOk())
            .andReturn();
    var data = json.readTree(response.getResponse().getContentAsString());
    String cookie =
        response.getResponse().getHeader("Set-Cookie").split(";", 2)[0].split("=", 2)[1];
    mvc.perform(get("/api/me").cookie(new Cookie(Accounts.COOKIE, cookie)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.owner").value(data.path("owner").asText()));
    String stored =
        db.queryForObject(
            "SELECT password_hash FROM accounts WHERE username=?", String.class, username);
    assertFalse(stored.contains("a-long-test-password"));
    assertTrue(Accounts.matches(creds.get("password"), stored));
    mvc.perform(
            post("/api/account/recover")
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsBytes(
                        Map.of(
                            "username",
                            username,
                            "password",
                            "another-test-password",
                            "recoveryCode",
                            data.path("recoveryCode").asText()))))
        .andExpect(status().isOk());
    mvc.perform(get("/api/me").cookie(new Cookie(Accounts.COOKIE, cookie)))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/account/login")
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsBytes(creds)))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void csrfBearerCannotBecomeHumanAndOversizeRejected() throws Exception {
    String token =
        memories
            .register(owner.getAttribute("owner").toString(), "mcp", "Agent")
            .get("token")
            .toString();
    mvc.perform(
            post("/api/folders")
                .session(owner)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"name\":\"bad\",\"projectPath\":\"\"}"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/folders/" + folder + "/import")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content("x".repeat(1048577)))
        .andExpect(status().isPayloadTooLarge());
  }
}
