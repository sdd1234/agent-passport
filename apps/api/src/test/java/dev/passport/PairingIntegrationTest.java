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
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:pairings;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
    })
@AutoConfigureMockMvc
class PairingIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired Auth auth;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate db;
  MockHttpSession owner, guest, stranger;
  String folder;

  MockHttpSession user() {
    var s = new MockHttpSession();
    String id = UUID.randomUUID().toString();
    auth.ensureUser(id);
    s.setAttribute("owner", id);
    return s;
  }

  JsonNode postJson(String path, Object body, MockHttpSession s, int expected) throws Exception {
    var result =
        mvc.perform(
                post("/api" + path)
                    .session(s)
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(json.writeValueAsBytes(body)))
            .andExpect(status().is(expected))
            .andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }

  JsonNode create() throws Exception {
    return postJson("/pairings", Map.of("folderId", folder, "role", "viewer"), owner, 200);
  }

  @BeforeEach
  void setup() throws Exception {
    db.update("DELETE FROM request_limits");
    owner = user();
    guest = user();
    stranger = user();
    folder =
        postJson("/folders", Map.of("name", "Pairing test", "projectPath", ""), owner, 200)
            .get("id")
            .asText();
  }

  @Test
  void bothPartiesRequiredAndReplayBlocked() throws Exception {
    var p = create();
    var code = Map.of("code", p.get("code").asText());
    String confirm = "/pairings/" + p.get("id").asText() + "/confirm";
    assertTrue(p.get("code").asText().matches("[0-9]{12}"));
    assertNotEquals(
        p.get("code").asText(),
        db.queryForObject(
            "SELECT code_hash FROM folder_pairings WHERE id=?",
            String.class,
            p.get("id").asText()));
    postJson(confirm, code, owner, 409);
    postJson("/pairings/join", code, owner, 400);
    postJson("/pairings/join", code, guest, 200);
    mvc.perform(get("/api/folders/" + folder).session(guest)).andExpect(status().isForbidden());
    postJson(confirm, code, guest, 403);
    postJson(
        confirm,
        Map.of(
            "code",
            p.get("code").asText().equals("000000000000") ? "111111111111" : "000000000000"),
        owner,
        400);
    postJson("/pairings/join", code, stranger, 409);
    mvc.perform(get("/api/pairings/" + p.get("id").asText()).session(stranger))
        .andExpect(status().isNotFound());
    postJson(confirm, code, owner, 200);
    mvc.perform(get("/api/folders/" + folder).session(guest))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("viewer"));
    postJson(confirm, code, owner, 409);
    postJson("/pairings/join", code, stranger, 409);
    mvc.perform(
            delete("/api/folders/" + folder + "/members/" + guest.getAttribute("owner"))
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/folders/" + folder).session(guest)).andExpect(status().isForbidden());
    postJson(confirm, code, owner, 409);
  }

  @Test
  void expiryCancellationAndRegenerationInvalidateCodes() throws Exception {
    var p = create();
    var q = create();
    postJson("/pairings/join", Map.of("code", p.get("code").asText()), guest, 404);
    postJson("/pairings/join", Map.of("code", q.get("code").asText()), guest, 200);
    db.update("UPDATE folder_pairings SET expires_at=0 WHERE id=?", q.get("id").asText());
    postJson(
        "/pairings/" + q.get("id").asText() + "/confirm",
        Map.of("code", q.get("code").asText()),
        owner,
        410);
    postJson("/pairings/join", Map.of("code", q.get("code").asText()), guest, 410);
    var c = create();
    mvc.perform(
            delete("/api/pairings/" + c.get("id").asText())
                .session(stranger)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isForbidden());
    mvc.perform(
            delete("/api/pairings/" + c.get("id").asText())
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    postJson("/pairings/join", Map.of("code", c.get("code").asText()), guest, 404);
  }

  @Test
  void noDirectSharingAndNoLegacyAuthentication() throws Exception {
    postJson(
        "/folders/" + folder + "/members",
        Map.of("userId", guest.getAttribute("owner"), "role", "editor"),
        owner,
        403);
    postJson("/pairings", Map.of("folderId", folder, "role", "editor"), guest, 403);
    for (String path :
        List.of(
            "/auth/siwe/nonce",
            "/auth/siwe/verify",
            "/anchors",
            "/anchors/confirm",
            "/folders/" + folder + "/invites",
            "/folders/accept-invite"))
      mvc.perform(
              post("/api" + path)
                  .session(owner)
                  .header("X-Passport-Request", "1")
                  .contentType("application/json")
                  .content("{}"))
          .andExpect(status().is4xxClientError());
    mvc.perform(
            post("/api/pairings/join")
                .contentType("application/json")
                .content("{\"code\":\"123456789012\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void concurrentClaimsAndConfirmationsHaveOneWinner() throws Exception {
    var p = create();
    String code = p.get("code").asText();
    String id = p.get("id").asText();
    var start = new java.util.concurrent.CountDownLatch(1);
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var jobs = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
      for (var session : List.of(guest, stranger))
        jobs.add(
            pool.submit(
                () -> {
                  start.await();
                  return mvc.perform(
                          post("/api/pairings/join")
                              .session(session)
                              .header("X-Passport-Request", "1")
                              .contentType("application/json")
                              .content(json.writeValueAsBytes(Map.of("code", code))))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      start.countDown();
      var results = new ArrayList<Integer>();
      for (var job : jobs) results.add(job.get(10, java.util.concurrent.TimeUnit.SECONDS));
      Collections.sort(results);
      assertEquals(List.of(200, 409), results);
      var confirmStart = new java.util.concurrent.CountDownLatch(1);
      jobs.clear();
      for (int n = 0; n < 2; n++)
        jobs.add(
            pool.submit(
                () -> {
                  confirmStart.await();
                  return mvc.perform(
                          post("/api/pairings/" + id + "/confirm")
                              .session(owner)
                              .header("X-Passport-Request", "1")
                              .contentType("application/json")
                              .content(json.writeValueAsBytes(Map.of("code", code))))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      confirmStart.countDown();
      results.clear();
      for (var job : jobs) results.add(job.get(10, java.util.concurrent.TimeUnit.SECONDS));
      Collections.sort(results);
      assertEquals(List.of(200, 409), results);
      assertEquals(
          1,
          db.queryForObject(
              "SELECT COUNT(*) FROM folder_members WHERE folder_id=?", Integer.class, folder));
    }
  }

  @Test
  void guessAttemptsStayLimitedAfterTransactionRollback() throws Exception {
    for (int i = 0; i < 30; i++)
      postJson("/pairings/join", Map.of("code", "123456789012"), guest, 404);
    postJson("/pairings/join", Map.of("code", "123456789012"), guest, 429);
  }
}
