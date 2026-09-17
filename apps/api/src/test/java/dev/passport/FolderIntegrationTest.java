package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:folders;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
    })
@AutoConfigureMockMvc
class FolderIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired Auth auth;
  @Autowired ObjectMapper json;
  @Autowired org.springframework.jdbc.core.JdbcTemplate db;
  MockHttpSession owner, guest;
  String guestId, id;

  MockHttpSession user() {
    var s = new MockHttpSession();
    String u = "folder-" + UUID.randomUUID();
    auth.ensureUser(u);
    s.setAttribute("owner", u);
    return s;
  }

  @BeforeEach
  void setup() throws Exception {
    owner = user();
    guest = user();
    guestId = guest.getAttribute("owner").toString();
    var result =
        mvc.perform(
                post("/api/folders")
                    .session(owner)
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(
                        json.writeValueAsString(
                            Map.of("name", "Project", "projectPath", "/private/project"))))
            .andExpect(status().isOk())
            .andReturn();
    id = json.readTree(result.getResponse().getContentAsString()).get("id").asText();
  }

  void share(String role) throws Exception {
    mvc.perform(
            post("/api/folders/" + id + "/members")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(json.writeValueAsString(Map.of("userId", guestId, "role", role))))
        .andExpect(status().isOk());
  }

  String editBody(int revision) throws Exception {
    return json.writeValueAsString(
        Map.of(
            "name",
            "Project",
            "projectPath",
            "/hijack",
            "handoff",
            "Next: implement imports",
            "revision",
            revision));
  }

  @Test
  void isolationSharingAndRevocation() throws Exception {
    mvc.perform(get("/api/folders/" + id).session(guest)).andExpect(status().isForbidden());
    mvc.perform(get("/api/folders").session(guest)).andExpect(content().json("[]"));
    share("viewer");
    mvc.perform(get("/api/folders/" + id).session(guest))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.project_path").value(""));
    mvc.perform(
            patch("/api/folders/" + id)
                .session(guest)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(editBody(1)))
        .andExpect(status().isForbidden());
    share("editor");
    mvc.perform(
            patch("/api/folders/" + id)
                .session(guest)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(editBody(1)))
        .andExpect(status().isOk());
    mvc.perform(get("/api/folders/" + id).session(owner))
        .andExpect(jsonPath("$.project_path").value("/private/project"))
        .andExpect(jsonPath("$.handoff").value("Next: implement imports"));
    mvc.perform(
            patch("/api/folders/" + id)
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(editBody(1)))
        .andExpect(status().isConflict());
    assertFalse(
        db.queryForObject("SELECT handoff FROM workspace_folders WHERE id=?", String.class, id)
            .contains("Next:"));
    mvc.perform(
            delete("/api/folders/" + id + "/members/" + guestId)
                .session(owner)
                .header("X-Passport-Request", "1"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/folders/" + id).session(guest)).andExpect(status().isForbidden());
  }

  @Test
  void noAnonymousAccessNoShareEscalationOrImplicitChildAccess() throws Exception {
    mvc.perform(get("/api/folders")).andExpect(status().isUnauthorized());
    share("editor");
    mvc.perform(get("/api/folders/" + id + "/members").session(guest))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/folders")
                .session(guest)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsString(
                        Map.of("name", "child", "projectPath", "", "parentId", id))))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/folders")
                .session(owner)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(
                    json.writeValueAsString(
                        Map.of("name", "child", "projectPath", "", "parentId", id))))
        .andExpect(status().isOk());
    mvc.perform(get("/api/folders").session(guest)).andExpect(jsonPath("$.length()").value(1));
    mvc.perform(
            patch("/api/folders/" + id)
                .session(owner)
                .contentType("application/json")
                .content(editBody(1)))
        .andExpect(status().isForbidden());
  }
}
