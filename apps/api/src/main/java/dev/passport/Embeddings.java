package dev.passport;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class Embeddings {
  final JdbcTemplate db;
  final Providers providers;

  public Embeddings(JdbcTemplate db, Providers providers) {
    this.db = db;
    this.providers = providers;
  }

  public boolean enabled() {
    return Config.env("SEARCH_MODE", "lexical").equals("vector");
  }

  @EventListener(ApplicationReadyEvent.class)
  public void initialize() {
    if (enabled()) {
      db.execute("CREATE EXTENSION IF NOT EXISTS vector");
      db.execute(
          "CREATE TABLE IF NOT EXISTS memory_embeddings (memory_id VARCHAR(80) NOT NULL, version"
              + " INT NOT NULL, embedding vector(1536) NOT NULL, PRIMARY KEY(memory_id,version))");
    }
  }

  String embed(String text) {
    if (Config.env("OPENAI_API_KEY", "").isBlank() || Config.env("EMBEDDING_MODEL", "").isBlank())
      throw Auth.error(503, "EMBEDDINGS_NOT_CONFIGURED");
    try {
      var body =
          Map.of("model", Config.env("EMBEDDING_MODEL", ""), "input", text, "dimensions", 1536);
      var request =
          HttpRequest.newBuilder(URI.create("https://api.openai.com/v1/embeddings"))
              .timeout(Duration.ofSeconds(30))
              .header("Authorization", "Bearer " + Config.env("OPENAI_API_KEY", ""))
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(providers.json.writeValueAsString(body)))
              .build();
      var response = providers.http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() / 100 != 2) throw Auth.error(502, "EMBEDDING_REQUEST_FAILED");
      var vector = providers.json.readTree(response.body()).path("data").path(0).path("embedding");
      if (vector.size() != 1536) throw Auth.error(502, "INVALID_EMBEDDING_DIMENSIONS");
      for (var n : vector)
        if (!n.isNumber() || !Double.isFinite(n.asDouble()))
          throw Auth.error(502, "INVALID_EMBEDDING");
      return vector.toString();
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw Auth.error(502, "EMBEDDING_UNAVAILABLE");
    }
  }

  public void index(String mid, int version, String content) {
    if (enabled())
      db.update(
          "INSERT INTO memory_embeddings VALUES(?,?,CAST(? AS vector)) ON"
              + " CONFLICT(memory_id,version) DO UPDATE SET embedding=EXCLUDED.embedding",
          mid,
          version,
          embed(content));
  }

  public void delete(String mid) {
    if (enabled()) db.update("DELETE FROM memory_embeddings WHERE memory_id=?", mid);
  }

  public Map<String, Double> similarities(
      String owner, String scope, String project, String query) {
    if (!enabled()) return Map.of();
    String vector = embed(query);
    String sql =
        "SELECT m.id,1-(e.embedding <=> CAST(? AS vector)) AS similarity FROM memories m JOIN"
            + " memory_embeddings e ON m.id=e.memory_id AND m.current_version=e.version JOIN"
            + " versions v ON v.memory_id=m.id AND v.version=m.current_version WHERE m.owner_id=?"
            + " AND m.scope=? AND m.status='current' AND (v.valid_to=0 OR v.valid_to>?)";
    List<Object> args = new ArrayList<>(List.of(vector, owner, scope, System.currentTimeMillis()));
    if (project != null && !project.isBlank()) {
      sql += " AND m.project=?";
      args.add(project);
    }
    Map<String, Double> result = new HashMap<>();
    for (var r : db.queryForList(sql, args.toArray()))
      result.put(r.get("id").toString(), ((Number) r.get("similarity")).doubleValue());
    return result;
  }
}
