package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.web3j.crypto.*;
import org.web3j.utils.Numeric;

@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
    })
@AutoConfigureMockMvc
class MemoryIntegrationTest {
  @Autowired MemoryService mem;
  @Autowired Auth auth;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  String owner, agent;

  @BeforeEach
  void init() {
    owner = "test-" + UUID.randomUUID();
    auth.ensureUser(owner);
    agent = mem.register(owner, "openai", "GPT").get("id").toString();
  }

  MemoryService.Proposal p(String content, String scope) {
    return new MemoryService.Proposal(
        "architecture.backend.framework", content, scope, "test", "decision", 0.95, 0.9, 0, agent);
  }

  @Test
  void handoffRevokeRegrantExpiry() {
    String claude = mem.register(owner, "anthropic", "Claude").get("id").toString();
    var proposal = mem.propose(owner, p("Spring Boot", "development"));
    mem.resolve(owner, proposal.get("id").toString(), true);
    assertThrows(
        ResponseStatusException.class,
        () -> mem.search(owner, claude, "backend", "development", "test", 5));
    mem.permission(owner, claude, "development", 1, 0, null);
    assertEquals(
        "Spring Boot",
        mem.search(owner, claude, "backend", "development", "test", 5).getFirst().get("content"));
    mem.permission(owner, claude, "development", 0, 0, null);
    assertThrows(
        ResponseStatusException.class,
        () -> mem.search(owner, claude, "backend", "development", "test", 5));
    mem.permission(owner, claude, "development", 1, 0, null);
    assertEquals(1, mem.search(owner, claude, "backend", "development", "test", 5).size());
    mem.db.update(
        "UPDATE permissions SET expires_at=? WHERE agent_id=?",
        System.currentTimeMillis() / 1000,
        claude);
    assertThrows(
        ResponseStatusException.class,
        () -> mem.search(owner, claude, "backend", "development", "test", 5));
  }

  @Test
  void conflictPreservesHistoryAndRejectsStaleProposal() {
    var first = mem.propose(owner, p("Node.js", "development"));
    String mid = mem.resolve(owner, first.get("id").toString(), true).get("memoryId").toString();
    assertEquals("duplicate", mem.propose(owner, p("Node.js", "development")).get("state"));
    var second = mem.propose(owner, p("Spring Boot", "development"));
    var stale = mem.propose(owner, p("Django", "development"));
    mem.resolve(owner, second.get("id").toString(), true);
    assertThrows(
        ResponseStatusException.class, () -> mem.resolve(owner, stale.get("id").toString(), true));
    var versions = mem.versions(owner, mid);
    assertEquals(2, versions.size());
    assertEquals("Spring Boot", versions.get(0).get("content"));
    assertEquals("Node.js", versions.get(1).get("content"));
    String stored =
        mem.db.queryForObject(
            "SELECT content FROM versions WHERE memory_id=? AND version=2", String.class, mid);
    assertFalse(stored.contains("Spring Boot"));
  }

  @Test
  void sensitiveProposalNotSearchableUntilOwnerApproves() {
    mem.permission(owner, agent, "personal", 3, 0, null);
    var proposal = mem.propose(owner, p("private fact", "personal"));
    assertTrue(mem.search(owner, agent, "fact", "personal", "test", 5).isEmpty());
    mem.resolve(owner, proposal.get("id").toString(), true);
    assertEquals(1, mem.search(owner, agent, "fact", "personal", "test", 5).size());
    String other = "other-" + UUID.randomUUID();
    auth.ensureUser(other);
    assertTrue(mem.list(other, null, null, null).isEmpty());
    assertThrows(
        ResponseStatusException.class,
        () ->
            mem.versions(other, mem.list(owner, null, null, null).getFirst().get("id").toString()));
  }

  @Test
  void agentIdentityCannotBeForgedOrApproveOwnMemory() throws Exception {
    var registered = mem.register(owner, "mcp", "IDE");
    String token = registered.get("token").toString();
    mvc.perform(
            post("/api/memories/search")
                .header("Authorization", "Bearer " + token)
                .header("X-Agent-Id", agent)
                .contentType("application/json")
                .content("{\"query\":\"test\",\"scope\":\"development\",\"topK\":5}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("AGENT_ID_MISMATCH"));
    mvc.perform(get("/api/memories").header("Authorization", "Bearer " + token))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/permissions/grant")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(
                    "{\"agentId\":\""
                        + registered.get("id")
                        + "\",\"scope\":\"development\",\"bits\":3}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void csrfBlocksCrossSite() throws Exception {
    mvc.perform(
            post("/api/auth/demo")
                .header("Origin", "https://evil.example")
                .header("X-Passport-Request", "1"))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/auth/demo")).andExpect(status().isForbidden());
  }

  @Test
  void siweSignatureReplayRejected() throws Exception {
    var key = Keys.createEcKeyPair();
    String address = "0x" + Keys.getAddress(key);
    MockHttpSession session = new MockHttpSession();
    String payload =
        mvc.perform(
                post("/api/auth/siwe/nonce")
                    .session(session)
                    .header("X-Passport-Request", "1")
                    .contentType("application/json")
                    .content(json.writeValueAsString(Map.of("address", address))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String message = json.readTree(payload).get("message").asText();
    var sig = Sign.signPrefixedMessage(message.getBytes(StandardCharsets.UTF_8), key);
    byte[] signature = new byte[65];
    System.arraycopy(sig.getR(), 0, signature, 0, 32);
    System.arraycopy(sig.getS(), 0, signature, 32, 32);
    signature[64] = sig.getV()[0];
    String request =
        json.writeValueAsString(
            Map.of("message", message, "signature", Numeric.toHexString(signature)));
    mvc.perform(
            post("/api/auth/siwe/verify")
                .session(session)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(request))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.owner").value(address));
    mvc.perform(
            post("/api/auth/siwe/verify")
                .session(session)
                .header("X-Passport-Request", "1")
                .contentType("application/json")
                .content(request))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void expiredMemoryExcludedAndDeleteRemovesPlaintext() {
    var proposal =
        mem.propose(
            owner,
            new MemoryService.Proposal(
                "test.expired", "expired", "development", "test", "todo", 1, 1, 1, agent));
    String mid = mem.resolve(owner, proposal.get("id").toString(), true).get("memoryId").toString();
    mem.permission(owner, agent, "development", 3, 0, null);
    assertTrue(mem.search(owner, agent, "expired", "development", "test", 5).isEmpty());
    mem.delete(owner, mid);
    assertEquals(
        0,
        mem.db.queryForObject(
            "SELECT COUNT(*) FROM versions WHERE memory_id=?", Integer.class, mid));
    assertEquals(
        0,
        mem.db.queryForObject(
            "SELECT COUNT(*) FROM proposals WHERE owner_id=?", Integer.class, owner));
  }

  @Test
  void anchorDeterministicAndNoRawScope() {
    var proposal = mem.propose(owner, p("Secret context", "personal"));
    mem.resolve(owner, proposal.get("id").toString(), true);
    assertEquals(mem.anchor(owner).get("root"), mem.anchor(owner).get("root"));
    assertNotEquals(
        mem.chain.scopeHash(owner, "personal", mem.salt(owner)), Hash.sha3String("personal"));
  }
}
