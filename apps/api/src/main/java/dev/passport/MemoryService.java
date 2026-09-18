package dev.passport;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class MemoryService {
  public static final List<String> SCOPES = List.of("development", "personal", "research");
  final JdbcTemplate db;
  final Crypto crypto;
  final ObjectMapper json;
  final TransactionTemplate tx;
  final Embeddings embeddings;
  final Plans plans;

  public MemoryService(
      JdbcTemplate db,
      Crypto crypto,
      ObjectMapper json,
      TransactionTemplate tx,
      Embeddings embeddings,
      Plans plans) {
    this.db = db;
    this.crypto = crypto;
    this.json = json;
    this.tx = tx;
    this.embeddings = embeddings;
    this.plans = plans;
  }

  String id() {
    return UUID.randomUUID().toString();
  }

  long now() {
    return System.currentTimeMillis();
  }

  public void audit(
      String owner, String actor, String action, String resource, String decision, String hash) {
    db.update(
        "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)",
        id(),
        owner,
        actor,
        action,
        resource,
        decision,
        hash,
        now());
  }

  public String salt(String owner) {
    return db.queryForObject("SELECT salt FROM users WHERE id=?", String.class, owner);
  }

  public Map<String, Object> register(String owner, String provider, String name) {
    if (!List.of("openai", "anthropic", "mcp").contains(provider))
      throw Auth.error(400, "INVALID_PROVIDER");
    String agent = id(), token = id() + id();
    db.update(
        "INSERT INTO agents VALUES(?,?,?,?,?)", agent, owner, provider, name, Crypto.hash(token));
    audit(owner, "owner", "AGENT_REGISTERED", agent, "ALLOW", null);
    return Map.of("id", agent, "provider", provider, "name", name, "token", token);
  }

  public List<Map<String, Object>> agents(String owner) {
    return db.queryForList(
        "SELECT id,provider,name FROM agents WHERE owner_id=? ORDER BY name", owner);
  }

  public void ownsAgent(String owner, String agent) {
    if (db.queryForObject(
            "SELECT COUNT(*) FROM agents WHERE id=? AND owner_id=?", Integer.class, agent, owner)
        == 0) throw Auth.error(404, "AGENT_NOT_FOUND");
  }

  public void scope(String scope) {
    if (!SCOPES.contains(scope)) throw Auth.error(400, "INVALID_SCOPE");
  }

  public void require(String owner, String agent, String scope, int bit) {
    scope(scope);
    ownsAgent(owner, agent);
    boolean allow = false;
    {
      var rows =
          db.queryForList(
              "SELECT * FROM permissions WHERE owner_id=? AND agent_id=? AND scope=?",
              owner,
              agent,
              scope);
      if (!rows.isEmpty()) {
        var p = rows.getFirst();
        long expiry = ((Number) p.get("expires_at")).longValue();
        allow =
            (((Number) p.get("bits")).intValue() & bit) == bit
                && (expiry == 0 || expiry > now() / 1000);
      }
    }
    audit(
        owner,
        agent,
        bit == 1 ? "MEMORY_READ" : "MEMORY_WRITE",
        scope,
        allow ? "ALLOW" : "DENY",
        null);
    if (!allow) throw Auth.error(403, "MEMORY_SCOPE_DENIED");
  }

  public synchronized void permission(
      String owner, String agent, String scope, int bits, long expires, String hash) {
    ownsAgent(owner, agent);
    scope(scope);
    if (bits < 0
        || bits > 3
        || expires < 0
        || (expires != 0 && expires <= now() / 1000 && bits > 0))
      throw Auth.error(400, "INVALID_GRANT");
    tx.executeWithoutResult(
        s -> {
          db.update(
              "DELETE FROM permissions WHERE owner_id=? AND agent_id=? AND scope=?",
              owner,
              agent,
              scope);
          db.update(
              "INSERT INTO permissions VALUES(?,?,?,?,?,?)",
              owner,
              agent,
              scope,
              bits,
              expires,
              hash);
          audit(
              owner,
              "owner",
              bits == 0 ? "ACCESS_REVOKED" : "ACCESS_GRANTED",
              agent + ":" + scope,
              "ALLOW",
              hash);
        });
  }

  public List<Map<String, Object>> permissions(String owner) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (var a : agents(owner))
      for (String s : SCOPES) {
        var rows =
            db.queryForList(
                "SELECT bits,expires_at,tx_hash FROM permissions WHERE owner_id=? AND agent_id=?"
                    + " AND scope=?",
                owner,
                a.get("id"),
                s);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("agentId", a.get("id"));
        p.put("scope", s);
        p.put("bits", rows.isEmpty() ? 0 : rows.getFirst().get("bits"));
        p.put("expiresAt", rows.isEmpty() ? 0 : rows.getFirst().get("expires_at"));
        if (((Number) p.get("expiresAt")).longValue() != 0
            && ((Number) p.get("expiresAt")).longValue() <= now() / 1000) p.put("bits", 0);
        out.add(p);
      }
    return out;
  }

  public Map<String, Object> map(Map<String, Object> r) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (var e : r.entrySet()) m.put(e.getKey().toLowerCase(java.util.Locale.ROOT), e.getValue());
    if (m.containsKey("content")) m.put("content", crypto.decrypt(m.get("content").toString()));
    return m;
  }

  public List<Map<String, Object>> list(String owner, String project, String scope, String status) {
    String sql =
        "SELECT"
            + " m.*,v.content,v.content_hash,v.source_agent,v.confidence,v.importance,v.created_at,v.valid_to"
            + " FROM memories m JOIN versions v ON m.id=v.memory_id AND m.current_version=v.version"
            + " WHERE m.owner_id=?";
    List<Object> args = new ArrayList<>(List.of(owner));
    if (project != null && !project.isBlank()) {
      sql += " AND m.project=?";
      args.add(project);
    }
    if (scope != null && !scope.isBlank()) {
      sql += " AND m.scope=?";
      args.add(scope);
    }
    if (status != null && !status.isBlank()) {
      sql += " AND m.status=?";
      args.add(status);
    }
    sql += " ORDER BY v.created_at DESC";
    return db.queryForList(sql, args.toArray()).stream().map(this::map).toList();
  }

  public Map<String, Object> memory(String owner, String mid) {
    var rows = db.queryForList("SELECT * FROM memories WHERE id=? AND owner_id=?", mid, owner);
    if (rows.isEmpty()) throw Auth.error(404, "MEMORY_NOT_FOUND");
    return rows.getFirst();
  }

  public List<Map<String, Object>> versions(String owner, String mid) {
    memory(owner, mid);
    return db
        .queryForList("SELECT * FROM versions WHERE memory_id=? ORDER BY version DESC", mid)
        .stream()
        .map(this::map)
        .toList();
  }

  public record Proposal(
      String canonicalKey,
      String content,
      String scope,
      String project,
      String type,
      double confidence,
      double importance,
      long validTo,
      String sourceAgent) {}

  public void validate(Proposal p) {
    scope(p.scope());
    if (p.canonicalKey() == null
        || !p.canonicalKey().matches("[a-z0-9][a-z0-9._-]{0,199}")
        || p.content() == null
        || p.content().isBlank()
        || p.content().length() > 10000
        || p.project() == null
        || p.project().isBlank()
        || p.project().length() > 100
        || !List.of(
                "profile_fact",
                "preference",
                "project_fact",
                "decision",
                "project_decision",
                "progress",
                "todo",
                "constraint",
                "summary")
            .contains(p.type())
        || !Double.isFinite(p.confidence())
        || p.confidence() < 0
        || p.confidence() > 1
        || !Double.isFinite(p.importance())
        || p.importance() < 0
        || p.importance() > 1
        || p.validTo() < 0) throw Auth.error(400, "INVALID_MEMORY");
  }

  String encode(Object v) {
    try {
      return json.writeValueAsString(v);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  Proposal decode(String v) {
    try {
      return json.readValue(v, Proposal.class);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public synchronized Map<String, Object> propose(String owner, Proposal p) {
    validate(p);
    if (p.importance() < 0.45) return Map.of("state", "skipped", "reason", "LOW_IMPORTANCE");
    return tx.execute(
        s -> {
          plans.lock(owner);
          var rows =
              db.queryForList(
                  "SELECT * FROM memories WHERE owner_id=? AND project=? AND scope=? AND"
                      + " canonical_key=?",
                  owner,
                  p.project(),
                  p.scope(),
                  p.canonicalKey());
          String mid = rows.isEmpty() ? null : rows.getFirst().get("id").toString();
          int version =
              rows.isEmpty() ? 0 : ((Number) rows.getFirst().get("current_version")).intValue();
          if (mid != null && !rows.getFirst().get("status").equals("deleted")) {
            var v = versions(owner, mid).getFirst();
            if (v.get("content").equals(p.content())) {
              audit(owner, p.sourceAgent(), "DUPLICATE_SKIPPED", mid, "ALLOW", null);
              return Map.<String, Object>of("state", "duplicate", "memoryId", mid);
            }
          }
          String pid = id();
          db.update(
              "INSERT INTO proposals VALUES(?,?,?,?,?,?,?)",
              pid,
              owner,
              crypto.encrypt(encode(p)),
              mid,
              version,
              "pending",
              now());
          audit(
              owner,
              p.sourceAgent(),
              mid == null ? "MEMORY_PROPOSED" : "CONFLICT_DETECTED",
              pid,
              "REVIEW",
              null);
          plans.enforce(owner);
          return Map.<String, Object>of(
              "id", pid, "state", "pending", "kind", mid == null ? "proposal" : "conflict");
        });
  }

  public List<Map<String, Object>> conflicts(String owner) {
    return db
        .queryForList(
            "SELECT * FROM proposals WHERE owner_id=? AND state='pending' ORDER BY created_at DESC",
            owner)
        .stream()
        .map(
            r -> {
              Map<String, Object> m = new LinkedHashMap<>(r);
              Proposal p = decode(crypto.decrypt(r.get("payload").toString()));
              m.remove("payload");
              m.put("proposal", p);
              m.put(
                  "existing",
                  r.get("memory_id") == null
                      ? null
                      : versions(owner, r.get("memory_id").toString()).getFirst());
              return m;
            })
        .toList();
  }

  public synchronized Map<String, Object> resolve(String owner, String pid, boolean accept) {
    return tx.execute(
        s -> {
          plans.lock(owner);
          var rows =
              db.queryForList(
                  "SELECT * FROM proposals WHERE id=? AND owner_id=? AND state='pending' FOR"
                      + " UPDATE",
                  pid,
                  owner);
          if (rows.isEmpty()) throw Auth.error(404, "PROPOSAL_NOT_FOUND");
          var r = rows.getFirst();
          Proposal p = decode(crypto.decrypt(r.get("payload").toString()));
          if (!accept) {
            db.update("UPDATE proposals SET state='rejected' WHERE id=?", pid);
            audit(owner, "owner", "PROPOSAL_REJECTED", pid, "ALLOW", null);
            return Map.<String, Object>of("state", "rejected");
          }
          String mid = (String) r.get("memory_id");
          int expected = ((Number) r.get("expected_version")).intValue();
          if (mid == null) {
            if (db.queryForObject(
                    "SELECT COUNT(*) FROM memories WHERE owner_id=? AND project=? AND scope=? AND"
                        + " canonical_key=?",
                    Integer.class,
                    owner,
                    p.project(),
                    p.scope(),
                    p.canonicalKey())
                > 0) throw Auth.error(409, "VERSION_CONFLICT_REPROPOSE");
            mid = id();
            db.update(
                "INSERT INTO memories VALUES(?,?,?,?,?,?,?,?)",
                mid,
                owner,
                p.canonicalKey(),
                p.project(),
                p.scope(),
                p.type(),
                1,
                "current");
          } else {
            int count =
                db.update(
                    "UPDATE memories SET current_version=?,status='current',type=? WHERE id=? AND"
                        + " owner_id=? AND current_version=?",
                    expected + 1,
                    p.type(),
                    mid,
                    owner,
                    expected);
            if (count != 1) throw Auth.error(409, "VERSION_CONFLICT_REPROPOSE");
          }
          db.update(
              "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?)",
              mid,
              expected + 1,
              crypto.encrypt(p.content()),
              Crypto.hash(p.content()),
              p.sourceAgent(),
              p.confidence(),
              p.importance(),
              now(),
              p.validTo());
          embeddings.index(mid, expected + 1, p.content());
          db.update("UPDATE proposals SET state='accepted',memory_id=? WHERE id=?", mid, pid);
          audit(owner, "owner", "MEMORY_APPROVED", mid, "ALLOW", null);
          plans.enforce(owner);
          return Map.<String, Object>of(
              "state", "accepted", "memoryId", mid, "version", expected + 1);
        });
  }

  public synchronized void delete(String owner, String mid) {
    var target = memory(owner, mid);
    tx.executeWithoutResult(
        s -> {
          for (var row :
              db.queryForList("SELECT id,payload FROM proposals WHERE owner_id=?", owner)) {
            Proposal proposal = decode(crypto.decrypt(row.get("payload").toString()));
            if (proposal.canonicalKey().equals(target.get("canonical_key"))
                && proposal.scope().equals(target.get("scope"))
                && proposal.project().equals(target.get("project")))
              db.update("DELETE FROM proposals WHERE id=?", row.get("id"));
          }
          embeddings.delete(mid);
          db.update("DELETE FROM versions WHERE memory_id=?", mid);
          db.update("DELETE FROM proposals WHERE owner_id=? AND memory_id=?", owner, mid);
          db.update("DELETE FROM memories WHERE id=?", mid);
          audit(owner, "owner", "MEMORY_DELETED", mid, "ALLOW", null);
        });
  }

  public List<Map<String, Object>> search(
      String owner, String agent, String query, String scope, String project, int topK) {
    require(owner, agent, scope, 1);
    if (topK < 1 || topK > 12 || query.length() > 2000) throw Auth.error(400, "INVALID_SEARCH");
    var similarities = embeddings.similarities(owner, scope, project, query);
    var candidates =
        new ArrayList<>(
            list(owner, project, scope, "current").stream()
                .filter(
                    m ->
                        ((Number) m.get("valid_to")).longValue() == 0
                            || ((Number) m.get("valid_to")).longValue() > now())
                .toList());
    for (var m : candidates) {
      String hay = (m.get("content") + " " + m.get("canonical_key")).toLowerCase();
      String[] terms = query.toLowerCase().split("\\s+");
      double lexical =
          Arrays.stream(terms).filter(t -> hay.contains(t)).count()
              / (double) Math.max(1, terms.length);
      double recency =
          Math.exp(-(now() - ((Number) m.get("created_at")).longValue()) / 2592000000.0);
      double semantic =
          embeddings.enabled() ? similarities.getOrDefault(m.get("id").toString(), 0.0) : lexical;
      m.put(
          "score",
          0.55 * semantic
              + 0.15 * recency
              + 0.15 * ((Number) m.get("importance")).doubleValue()
              + 0.10
              + 0.05 * ((Number) m.get("confidence")).doubleValue());
    }
    candidates.sort(Comparator.comparingDouble(m -> -((Number) m.get("score")).doubleValue()));
    return candidates.stream().limit(topK).toList();
  }
}
