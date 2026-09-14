package dev.passport;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "RUN_PG_TESTS", matches = "true")
class PgVectorIntegrationTest {
  @Autowired MemoryService mem;
  @Autowired Auth auth;
  @MockitoSpyBean Embeddings embeddings;

  @Test
  void realPostgresVectorRanksFiltersAndDeletes() {
    String owner = "pg-" + UUID.randomUUID();
    auth.ensureUser(owner);
    String agent = mem.register(owner, "mcp", "PG test").get("id").toString();
    mem.permission(owner, agent, "development", 3, 0, null);
    String x = "[1,0" + ",0".repeat(1534) + "]", y = "[0,1" + ",0".repeat(1534) + "]";
    doReturn(x).when(embeddings).embed("서버는 JVM 기반 프레임워크");
    doReturn(y).when(embeddings).embed("데이터베이스는 PostgreSQL");
    doReturn(x).when(embeddings).embed("백엔드 기술이 뭐지?");
    for (String content : List.of("데이터베이스는 PostgreSQL", "서버는 JVM 기반 프레임워크")) {
      var p =
          mem.propose(
              owner,
              new MemoryService.Proposal(
                  content.startsWith("서버") ? "architecture.backend" : "architecture.database",
                  content,
                  "development",
                  "pg-test",
                  "decision",
                  1,
                  1,
                  0,
                  agent));
      mem.resolve(owner, p.get("id").toString(), true);
    }
    var results = mem.search(owner, agent, "백엔드 기술이 뭐지?", "development", "pg-test", 1);
    assertEquals("서버는 JVM 기반 프레임워크", results.getFirst().get("content"));
    assertEquals(
        2,
        mem.db.queryForObject(
            "SELECT COUNT(*) FROM memory_embeddings e JOIN memories m ON m.id=e.memory_id WHERE"
                + " m.owner_id=?",
            Integer.class,
            owner));
    assertTrue(
        mem.search(owner, agent, "백엔드 기술이 뭐지?", "development", "wrong-project", 5).isEmpty());
    mem.permission(owner, agent, "development", 0, 0, null);
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> mem.search(owner, agent, "백엔드 기술이 뭐지?", "development", "pg-test", 5));
    String mid = results.getFirst().get("id").toString();
    mem.delete(owner, mid);
    assertEquals(
        0,
        mem.db.queryForObject(
            "SELECT COUNT(*) FROM memory_embeddings WHERE memory_id=?", Integer.class, mid));
  }
}
