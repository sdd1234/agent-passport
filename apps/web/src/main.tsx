import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ShieldCheck,
  Fingerprint,
  Layers,
  MessageSquare,
  GitMerge,
  Activity,
  ChevronDown,
  X,
  Check,
  Copy,
  Download,
  Wallet,
  LockKeyhole,
  SlidersHorizontal,
  Send,
  RefreshCw,
  Code2,
  BookOpen,
  User,
  Globe2,
  CircleHelp,
  ExternalLink,
  Trash2,
  History,
  LoaderCircle,
} from "lucide-react";
import { BrowserProvider, Contract } from "ethers";
import "./style.css";
type Row = Record<string, any>;
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api" + path, {
    method: method || (body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Passport-Request": "1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({ code: "NETWORK_ERROR" }));
  if (!r.ok) throw new Error(data.code || `요청 실패 (${r.status})`);
  return data;
}
const scopes = ["development", "personal", "research"];
const scopeLabels: Row = {
  development: "개발 · 프로젝트",
  personal: "개인 정보",
  research: "리서치",
};
const tabs = [
  { id: "memories", label: "기억 탐색기", en: "Memory explorer", icon: Layers },
  {
    id: "playground",
    label: "Agent 플레이그라운드",
    en: "Agent playground",
    icon: MessageSquare,
  },
  {
    id: "permissions",
    label: "접근 권한",
    en: "Permissions",
    icon: ShieldCheck,
  },
  { id: "conflicts", label: "검토함", en: "Review inbox", icon: GitMerge },
  { id: "audit", label: "감사 로그", en: "Audit trail", icon: Activity },
];
const abi = [
  "function grantAccess(bytes32,bytes32,uint8,uint64)",
  "function revokeAccess(bytes32,bytes32)",
  "function anchorMemoryRoot(bytes32,bytes32)",
];
function App() {
  const [health, setHealth] = useState<Row>({ mode: "demo", providers: {} }),
    [owner, setOwner] = useState(""),
    [tab, setTab] = useState("memories"),
    [memories, setMemories] = useState<Row[]>([]),
    [agents, setAgents] = useState<Row[]>([]),
    [permissions, setPermissions] = useState<Row[]>([]),
    [conflicts, setConflicts] = useState<Row[]>([]),
    [audit, setAudit] = useState<Row[]>([]),
    [search, setSearch] = useState(""),
    [scope, setScope] = useState(""),
    [project, setProject] = useState(""),
    [modal, setModal] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [versions, setVersions] = useState<Row[]>([]),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [token, setToken] = useState(""),
    [anchor, setAnchor] = useState<Row | null>(null);
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 4500);
  };
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  async function refresh() {
    const result = await Promise.all([
      api("/memories"),
      api("/agents"),
      api("/permissions"),
      api("/conflicts"),
      api("/audit"),
    ]);
    setMemories(result[0]);
    setAgents(result[1]);
    setPermissions(result[2]);
    setConflicts(result[3]);
    setAudit(result[4]);
  }
  useEffect(() => {
    void (async () => {
      try {
        setHealth(await api("/health"));
        const me = await api("/me");
        setOwner(me.owner);
        await refresh();
      } catch (e) {
        if ((e as Error).message !== "LOGIN_REQUIRED")
          setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector(".modal") as HTMLElement | null;
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input,textarea,select,a[href]",
        ) || [],
      );
    elements()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal("");
      if (e.key === "Tab") {
        const es = elements(),
          first = es[0],
          last = es[es.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [modal]);
  async function demo() {
    await api("/auth/demo", {});
    setOwner("demo-owner");
    await api("/demo/seed", {});
    await refresh();
  }
  async function wallet() {
    const ethereum = (window as any).ethereum;
    if (!ethereum)
      throw new Error(
        "MetaMask 등 Ethereum 지갑 확장 프로그램을 설치해 주세요.",
      );
    const provider = new BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== health.chainId)
      throw new Error(
        `지갑 네트워크를 Chain ID ${health.chainId}로 변경해 주세요.`,
      );
    const { message } = await api("/auth/siwe/nonce", {
      address: await signer.getAddress(),
    });
    const signature = await signer.signMessage(message);
    const me = await api("/auth/siwe/verify", { message, signature });
    setOwner(me.owner);
    await refresh();
    notify("지갑 서명으로 로그인했습니다.");
  }
  async function contract() {
    const p = new BrowserProvider((window as any).ethereum);
    const signer = await p.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== owner.toLowerCase())
      throw new Error("로그인한 지갑과 현재 지갑이 다릅니다.");
    if (Number((await p.getNetwork()).chainId) !== health.chainId)
      throw new Error("지갑 네트워크를 확인해 주세요.");
    return new Contract(health.registry, abi, signer);
  }
  async function grant(p: Row, bits: number, ttl = 0) {
    let txHash;
    const expiresAt = ttl ? Math.floor(Date.now() / 1000) + ttl : 0;
    if (health.mode === "live") {
      const c = await contract();
      const tx = bits
        ? await c.grantAccess(p.agentHash, p.scopeHash, bits, expiresAt)
        : await c.revokeAccess(p.agentHash, p.scopeHash);
      notify("지갑 트랜잭션 확인을 기다리는 중입니다.");
      await tx.wait();
      txHash = tx.hash;
    }
    await api("/permissions/" + (bits ? "grant" : "revoke"), {
      agentId: p.agentId,
      scope: p.scope,
      bits,
      expiresAt,
      txHash,
    });
    await refresh();
    notify(
      bits
        ? "권한을 갱신했습니다."
        : "권한을 철회했습니다. 다음 검색부터 차단됩니다.",
    );
  }
  async function showMemory(m: Row) {
    setSelected(m);
    setVersions(await api(`/memories/${m.id}/versions`));
    setModal("detail");
  }
  const filtered = memories.filter(
    (m) =>
      (!scope || m.scope === scope) &&
      (!project || m.project === project) &&
      (m.content + " " + m.canonical_key)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const source = (id: string) =>
    id === "owner"
      ? "나"
      : agents.find((a) => a.id === id)?.name || "이전 Agent";
  const currentTab = tabs.find((t) => t.id === tab)!;
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("memories");
          }}
        >
          <span className="brand-mark">
            <Fingerprint size={26} />
          </span>
          <span>
            agent<span className="brand-light">passport</span>
            <small>YOUR CONTEXT. YOUR CONTROL.</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">J</span>
          <div>
            Personal workspace<small>나만의 기억 공간</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-label={t.label}
              title={t.label}
              className={tab === t.id ? "nav active" : "nav"}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={19} />
              <span>{t.label}</span>
              {t.id === "conflicts" && conflicts.length > 0 && (
                <b className="nav-count">{conflicts.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label connection-label">
          CONNECTED AGENTS{" "}
          <button aria-label="Agent 추가" onClick={() => setModal("agent")}>
            <Plus size={15} />
          </button>
        </div>
        <div className="agent-list">
          {agents.length ? (
            agents.map((a) => (
              <div key={a.id}>
                <span className={"provider " + a.provider}>
                  {a.provider === "openai" ? "G" : "✳"}
                </span>
                <span>{a.name}</span>
                <i className="dot" />
              </div>
            ))
          ) : (
            <p className="muted">연결된 Agent가 없습니다.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="ownership">
            <ShieldCheck size={22} />
            <strong>기억의 주인은 당신입니다.</strong>
            <p>
              기억은 오프체인에, 동의는
              <br />
              당신의 지갑에 남습니다.
            </p>
            <button onClick={() => setModal("about")}>
              작동 방식 알아보기 <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="profile"
            onClick={() =>
              owner
                ? run(async () => {
                    await api("/auth/logout", {});
                    setOwner("");
                    setMemories([]);
                    setAgents([]);
                    setPermissions([]);
                    setConflicts([]);
                    setAudit([]);
                  })
                : run(wallet)
            }
          >
            <span className="avatar">{owner ? "J" : <Wallet size={17} />}</span>
            <span>
              {owner === "demo-owner"
                ? "Demo workspace"
                : owner
                  ? owner.slice(0, 7) + "…" + owner.slice(-4)
                  : "지갑 연결"}
              <small>
                {owner ? "클릭하여 로그아웃" : "나의 Passport 시작하기"}
              </small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            Workspace <span>/</span> <b>{currentTab.en}</b>
          </div>
          <div className="top-actions">
            <span className="network">
              <i className="dot" />
              {health.mode === "demo"
                ? "Local demo · 체인 미연결"
                : "EVM · " + health.chainId}
            </span>
            <button
              className="icon-btn"
              aria-label="도움말"
              onClick={() => setModal("about")}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR PERSONAL CONTEXT LAYER</div>
              <h1>
                {currentTab.label}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {tab === "memories"
                  ? "여러 AI가 함께 기억하고, 당신이 직접 관리하는 하나의 공간."
                  : tab === "permissions"
                    ? "어떤 Agent가 무엇을 읽고 쓸지, 당신이 결정합니다."
                    : tab === "playground"
                      ? "다른 Agent, 새로운 세션. 같은 기억으로 이어지는 대화."
                      : tab === "conflicts"
                        ? "새로운 기억과 바뀐 결정을 확인하고 승인하세요."
                        : "모든 기억 접근과 동의 변경을 투명하게 확인하세요."}
              </p>
            </div>
            <div className="heading-actions">
              {tab === "memories" && (
                <>
                  <button
                    className="btn"
                    onClick={() =>
                      run(async () => {
                        const data = await api("/export");
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(data, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "agent-passport-export.json";
                        a.click();
                        URL.revokeObjectURL(url);
                        notify("기억을 JSON으로 내보냈습니다.");
                      })
                    }
                  >
                    <Download size={16} />
                    내보내기
                  </button>
                  <button
                    className="btn primary"
                    disabled={!owner}
                    onClick={() => setModal("memory")}
                  >
                    <Plus size={17} />
                    기억 추가
                  </button>
                </>
              )}
              {tab === "playground" && (
                <span className="tag neutral">매 요청마다 새 컨텍스트</span>
              )}
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!ready ? (
            <div className="empty">
              <LoaderCircle className="spin" /> Passport를 불러오는 중입니다.
            </div>
          ) : !owner ? (
            <section className="welcome">
              <div className="welcome-art">
                <Fingerprint size={100} strokeWidth={0.8} />
                <span>ONE MEMORY. EVERY AGENT.</span>
              </div>
              <div>
                <span className="eyebrow">MEET YOUR AGENT PASSPORT</span>
                <h2>
                  AI는 바꿔도,
                  <br />
                  기억은 가지고 가세요.
                </h2>
                <p>
                  프로젝트의 결정부터 나만의 선호까지.
                  <br />
                  필요한 기억만, 허용한 Agent와 공유하세요.
                </p>
                <div className="welcome-buttons">
                  {health.mode === "demo" && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(demo)}
                    >
                      데모 시작하기 <ArrowRight size={17} />
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => run(wallet)}
                  >
                    <Wallet size={17} />
                    지갑으로 로그인
                  </button>
                </div>
                <small>
                  데모는 예시 데이터와 시뮬레이션 응답을 사용합니다.
                </small>
              </div>
            </section>
          ) : (
            <>
              {tab === "memories" && (
                <>
                  <section className="hero-strip">
                    <div>
                      <span className="tag hero-tag">
                        <span className="dot" /> PORTABLE BY DESIGN
                      </span>
                      <h2>
                        당신의 맥락에,
                        <br />
                        <em>경계가 없도록.</em>
                      </h2>
                      <p>
                        Agent를 바꿔도 처음부터 설명할 필요 없어요.
                        <br />
                        승인된 기억으로 다음 대화를 이어가세요.
                      </p>
                      <button onClick={() => setTab("playground")}>
                        Agent 간 기억 공유해 보기 <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="orbit-art">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="passport-card">
                        <div>
                          <Fingerprint size={27} />
                          <ArrowUpRight size={18} />
                        </div>
                        <span>
                          AGENT
                          <br />
                          PASSPORT
                        </span>
                        <small>MEMORY WITHOUT BORDERS</small>
                        <div className="passport-lines">
                          |||| ||| || ||||| || ||| ||||||
                        </div>
                      </div>
                      <span className="orbit-node node-g">G</span>
                      <span className="orbit-node node-c">✳</span>
                      <span className="orbit-node node-code">
                        <Code2 size={22} />
                      </span>
                    </div>
                  </section>
                  <section className="stats">
                    <div>
                      <span>
                        저장된 기억 <Layers size={16} />
                      </span>
                      <strong>
                        {memories.length.toString().padStart(2, "0")}
                        <small>memories</small>
                      </strong>
                      <p>내가 소유하는 공통 컨텍스트</p>
                    </div>
                    <div>
                      <span>
                        연결된 Agent <Globe2 size={16} />
                      </span>
                      <strong>
                        {agents.length.toString().padStart(2, "0")}
                        <small>agents</small>
                      </strong>
                      <p>
                        <i className="dot" /> 공급자에 구애받지 않는 연결
                      </p>
                    </div>
                    <div>
                      <span>
                        검토가 필요한 기억 <GitMerge size={16} />
                      </span>
                      <strong>
                        {conflicts.length.toString().padStart(2, "0")}
                        <small>pending</small>
                      </strong>
                      <button onClick={() => setTab("conflicts")}>
                        검토함에서 확인하기 <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </section>
                  <div className="section-head">
                    <h2>
                      나의 기억 <span>{filtered.length}</span>
                    </h2>
                    <div className="view-note">
                      <ShieldCheck size={14} /> 원문은 암호화하여 오프체인에
                      보관
                    </div>
                  </div>
                  <div className="filters">
                    <label className="search">
                      <Search size={17} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="기억의 내용이나 키를 검색하세요"
                      />
                    </label>
                    <select
                      aria-label="프로젝트 필터"
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                    >
                      <option value="">모든 프로젝트</option>
                      {[...new Set(memories.map((m) => m.project))].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Scope 필터"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    >
                      <option value="">모든 Scope</option>
                      {scopes.map((s) => (
                        <option key={s} value={s}>
                          {scopeLabels[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      aria-label="필터 초기화"
                      onClick={() => {
                        setSearch("");
                        setScope("");
                        setProject("");
                      }}
                    >
                      <SlidersHorizontal size={17} />
                    </button>
                  </div>
                  <div className="memory-grid">
                    {filtered.map((m) => (
                      <button
                        key={m.id}
                        className="memory-card"
                        onClick={() => run(() => showMemory(m))}
                      >
                        <div className="card-top">
                          <span className={"scope-icon " + m.scope}>
                            {m.scope === "development" ? (
                              <Code2 size={17} />
                            ) : m.scope === "personal" ? (
                              <User size={17} />
                            ) : (
                              <BookOpen size={17} />
                            )}
                          </span>
                          <span className="scope-label">{m.scope}</span>
                          <span className="tag current">
                            <i className="dot" />
                            Current
                          </span>
                        </div>
                        <span className="memory-key">{m.canonical_key}</span>
                        <h3>{m.content}</h3>
                        <div className="card-project">
                          <span>#</span>
                          {m.project}
                        </div>
                        <div className="card-bottom">
                          <span>
                            <span
                              className={
                                "tiny-provider " +
                                (agents.find((a) => a.id === m.source_agent)
                                  ?.provider || "owner")
                              }
                            >
                              {m.source_agent === "owner"
                                ? "J"
                                : agents.find((a) => a.id === m.source_agent)
                                      ?.provider === "anthropic"
                                  ? "✳"
                                  : "G"}
                            </span>
                            {source(m.source_agent)}
                          </span>
                          <span>
                            v{m.current_version}
                            <i />
                            신뢰도 {Math.round(m.confidence * 100)}%
                          </span>
                        </div>
                      </button>
                    ))}
                    <button
                      className="add-card"
                      onClick={() => setModal("memory")}
                    >
                      <span>
                        <Plus size={21} />
                      </span>
                      <strong>새로운 기억 추가</strong>
                      <small>다음 Agent에게 전하고 싶은 맥락</small>
                    </button>
                  </div>
                  {!filtered.length && (
                    <p className="muted">
                      조건에 맞는 기억이 없습니다. 새 기억을 추가하거나 필터를
                      변경하세요.
                    </p>
                  )}
                  <footer>
                    <span>
                      <LockKeyhole size={13} /> Your memory belongs to you.
                      Always.
                    </span>
                    <button
                      onClick={() =>
                        run(async () => {
                          const a = await api("/anchors", {});
                          setAnchor(a);
                          setModal("anchor");
                        })
                      }
                    >
                      무결성 증명 만들기 <ArrowUpRight size={13} />
                    </button>
                  </footer>
                </>
              )}
              {tab === "permissions" && (
                <PermissionView
                  permissions={permissions}
                  agents={agents}
                  busy={busy}
                  grant={(p, b, t) => run(() => grant(p, b, t))}
                  mode={health.mode}
                />
              )}
              {tab === "playground" && (
                <Playground
                  agents={agents}
                  health={health}
                  refresh={refresh}
                  onReview={() => setTab("conflicts")}
                />
              )}
              {tab === "conflicts" && (
                <div className="review-list">
                  {conflicts.length === 0 ? (
                    <div className="empty">
                      <ShieldCheck size={36} />
                      <h3>모든 기억을 검토했습니다.</h3>
                      <p>Agent가 새 기억을 제안하면 이곳에 표시됩니다.</p>
                    </div>
                  ) : (
                    conflicts.map((c) => (
                      <article className="review-card" key={c.id}>
                        <div className="section-head">
                          <div>
                            <span
                              className={
                                "tag " + (c.existing ? "warning" : "current")
                              }
                            >
                              {c.existing ? "변경된 결정" : "새로운 기억"}
                            </span>
                            <h3>{c.proposal.canonicalKey}</h3>
                          </div>
                          <small>{scopeLabels[c.proposal.scope]}</small>
                        </div>
                        <div className="comparison">
                          {c.existing && (
                            <div>
                              <label>기존 기억 · v{c.expected_version}</label>
                              <p>{c.existing.content}</p>
                              <small>{source(c.existing.source_agent)}</small>
                            </div>
                          )}
                          <div className="proposed">
                            <label>
                              제안된 기억 ·{" "}
                              {Math.round(c.proposal.confidence * 100)}%
                            </label>
                            <p>{c.proposal.content}</p>
                            <small>{source(c.proposal.sourceAgent)}</small>
                          </div>
                        </div>
                        <div className="review-actions">
                          <small>
                            {c.existing
                              ? "승인하면 기존 버전은 이력에 보존됩니다."
                              : "승인된 기억만 Agent 검색에 포함됩니다."}
                          </small>
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api(`/conflicts/${c.id}/resolve`, {
                                  accept: false,
                                });
                                await refresh();
                              })
                            }
                          >
                            거절
                          </button>
                          <button
                            className="btn primary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api(`/conflicts/${c.id}/resolve`, {
                                  accept: true,
                                });
                                await refresh();
                                notify("기억을 승인했습니다.");
                              })
                            }
                          >
                            <Check size={16} />
                            승인하기
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}
              {tab === "audit" && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>이벤트</th>
                        <th>수행 주체</th>
                        <th>대상</th>
                        <th>결과</th>
                        <th>시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <Activity size={14} /> {a.action}
                          </td>
                          <td>{source(a.actor)}</td>
                          <td className="mono truncate" title={a.resource}>
                            {a.resource}
                          </td>
                          <td>
                            <span
                              className={
                                "tag " +
                                (a.decision === "DENY"
                                  ? "denied"
                                  : a.decision === "REVIEW"
                                    ? "warning"
                                    : "current")
                              }
                            >
                              {a.decision}
                            </span>
                          </td>
                          <td>
                            {new Date(a.created_at).toLocaleString("ko-KR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!audit.length && (
                    <div className="empty">아직 기록된 이벤트가 없습니다.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {busy && (
        <div className="working">
          <LoaderCircle className="spin" size={16} />
          처리 중
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Passport 상세"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-btn"
              aria-label="닫기"
              onClick={() => setModal("")}
            >
              <X size={21} />
            </button>
            {modal === "memory" && (
              <>
                <span className="eyebrow">NEW MEMORY</span>
                <h2>기억 추가하기</h2>
                <p>먼저 후보를 만들고, 검토함에서 승인합니다.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/memories/propose", {
                        canonicalKey: f.get("key"),
                        content: f.get("content"),
                        scope: f.get("scope"),
                        project: f.get("project"),
                        type: f.get("type"),
                        confidence: 1,
                        importance: 0.9,
                        validTo: 0,
                      });
                      await refresh();
                      setModal("");
                      setTab("conflicts");
                      notify("검토함에 기억 후보를 추가했습니다.");
                    });
                  }}
                >
                  <label>
                    기억 키
                    <input
                      name="key"
                      required
                      pattern="[a-z0-9][a-z0-9._-]*"
                      maxLength={200}
                      placeholder="architecture.backend.framework"
                    />
                  </label>
                  <label>
                    기억할 내용
                    <textarea
                      name="content"
                      required
                      maxLength={10000}
                      placeholder="백엔드는 Spring Boot를 사용합니다."
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Scope
                      <select name="scope">
                        {scopes.map((s) => (
                          <option key={s} value={s}>
                            {scopeLabels[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      유형
                      <select name="type">
                        <option value="decision">결정</option>
                        <option value="preference">선호</option>
                        <option value="project_fact">프로젝트 정보</option>
                        <option value="todo">할 일</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    프로젝트
                    <input
                      name="project"
                      required
                      defaultValue="agent-passport"
                      maxLength={100}
                    />
                  </label>
                  <button className="btn primary" disabled={busy}>
                    기억 후보 만들기 <ArrowRight size={16} />
                  </button>
                </form>
              </>
            )}
            {modal === "agent" && (
              <>
                <span className="eyebrow">CONNECT AN AGENT</span>
                <h2>새 Agent 연결</h2>
                <p>등록 후 접근 권한에서 Scope별 권한을 부여하세요.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      const a = await api("/agents", {
                        name: f.get("name"),
                        provider: f.get("provider"),
                      });
                      setToken(a.token);
                      await refresh();
                      setModal("token");
                    });
                  }}
                >
                  <label>
                    Agent 이름
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="My Claude Agent"
                    />
                  </label>
                  <label>
                    공급자
                    <select name="provider">
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="mcp">MCP Client / IDE</option>
                    </select>
                  </label>
                  <button className="btn primary" disabled={busy || !owner}>
                    Agent 등록 <Plus size={16} />
                  </button>
                </form>
              </>
            )}
            {modal === "token" && (
              <>
                <h2>Agent 토큰이 발급되었습니다.</h2>
                <p>
                  이 토큰은 한 번만 표시됩니다. MCP 서버 환경변수
                  PASSPORT_AGENT_TOKEN에 설정하세요.
                </p>
                <code className="token">{token}</code>
                <button
                  className="btn"
                  onClick={() =>
                    run(async () => {
                      await navigator.clipboard.writeText(token);
                      notify("토큰을 복사했습니다.");
                    })
                  }
                >
                  <Copy size={16} />
                  복사
                </button>
              </>
            )}
            {modal === "detail" && selected && (
              <>
                <span className="eyebrow">MEMORY PASSPORT</span>
                <h2>{selected.canonical_key}</h2>
                <div className="detail-content">{selected.content}</div>
                <div className="detail-meta">
                  <span>{selected.scope}</span>
                  <span>{selected.project}</span>
                  <span>신뢰도 {Math.round(selected.confidence * 100)}%</span>
                </div>
                <h3>
                  <History size={17} /> 버전 이력
                </h3>
                <div className="version-list">
                  {versions.map((v, i) => (
                    <div key={v.version}>
                      <span
                        className={"tag " + (i === 0 ? "current" : "neutral")}
                      >
                        {i === 0 ? "Current" : "Superseded"} · v{v.version}
                      </span>
                      <p>{v.content}</p>
                      <small>
                        {source(v.source_agent)} ·{" "}
                        {new Date(v.created_at).toLocaleString("ko-KR")}
                      </small>
                      <code>{v.content_hash}</code>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api(
                        `/memories/${selected.id}`,
                        {
                          content: f.get("content"),
                          expectedVersion: selected.current_version,
                        },
                        "PATCH",
                      );
                      await refresh();
                      setModal("");
                      setTab("conflicts");
                    });
                  }}
                >
                  <label>
                    내용 수정 제안
                    <textarea
                      name="content"
                      required
                      defaultValue={selected.content}
                    />
                  </label>
                  <button className="btn" disabled={busy}>
                    수정 제안
                  </button>
                </form>
                <button
                  className="btn danger"
                  onClick={() => setModal("delete")}
                >
                  <Trash2 size={15} />
                  기억 삭제
                </button>
              </>
            )}
            {modal === "delete" && selected && (
              <>
                <h2>이 기억을 삭제할까요?</h2>
                <p>
                  원문과 모든 버전이 삭제됩니다. 감사 로그와 기존 무결성 hash는
                  남습니다.
                </p>
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(
                        `/memories/${selected.id}`,
                        undefined,
                        "DELETE",
                      );
                      await refresh();
                      setModal("");
                      notify("기억과 원문 버전을 삭제했습니다.");
                    })
                  }
                >
                  삭제하기
                </button>
              </>
            )}
            {modal === "anchor" && anchor && (
              <>
                <span className="eyebrow">INTEGRITY PROOF</span>
                <h2>기억의 무결성 증명</h2>
                <p>
                  {anchor.leafCount}개 버전을 Merkle root 하나로 묶었습니다.
                </p>
                <code className="token">{anchor.root}</code>
                <p>
                  {health.mode === "demo"
                    ? "로컬에서 생성한 증명입니다. 블록체인에 기록되지 않았습니다."
                    : "지갑으로 서명하면 원문 없이 root만 계약에 기록합니다."}
                </p>
                {health.mode === "live" && (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const c = await contract();
                        const tx = await c.anchorMemoryRoot(
                          anchor.batchId,
                          anchor.root,
                        );
                        await tx.wait();
                        await api("/anchors/confirm", {
                          batchId: anchor.batchId,
                          txHash: tx.hash,
                        });
                        await refresh();
                        notify("온체인 무결성 증명이 확인되었습니다.");
                        setModal("");
                      })
                    }
                  >
                    지갑으로 앵커 기록
                  </button>
                )}
              </>
            )}
            {modal === "about" && (
              <>
                <span className="eyebrow">HOW IT WORKS</span>
                <h2>하나의 기억, 여러 Agent.</h2>
                <div className="about-steps">
                  <p>
                    <b>01 · 기억 만들기</b>대화에서 장기 기억 후보를 추출하고
                    사용자가 승인합니다.
                  </p>
                  <p>
                    <b>02 · 필요한 만큼 공유</b>Agent × Scope별 READ / WRITE
                    권한을 서버가 검증합니다.
                  </p>
                  <p>
                    <b>03 · 이어서 작업하기</b>새로운 Agent가 승인된 기억을
                    검색하고 출처와 함께 활용합니다.
                  </p>
                  <p>
                    <b>04 · 소유권 지키기</b>원문은 AES-GCM 암호화 저장, 실제
                    체인 모드의 권한은 사용자 지갑으로 서명합니다.
                  </p>
                </div>
                <p className="mode-note">
                  현재{" "}
                  {health.mode === "demo"
                    ? "데모 모드: H2 영속 DB, 로컬 권한, 규칙 기반 추출과 시뮬레이션 응답."
                    : "실제 연동 모드: 지갑과 EVM 계약이 필요합니다."}{" "}
                  Playground의 실제 API 모드는 서버에 설정된 공급자 키를
                  사용합니다.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function PermissionView({
  permissions,
  agents,
  busy,
  grant,
  mode,
}: {
  permissions: Row[];
  agents: Row[];
  busy: boolean;
  grant: (p: Row, b: number, t: number) => void;
  mode: string;
}) {
  const [ttl, setTtl] = useState(0);
  return (
    <>
      <div className="info-strip">
        <ShieldCheck size={21} />
        <div>
          <strong>최소 권한으로, 필요한 기억만.</strong>
          <p>
            {mode === "demo"
              ? "데모 권한도 모든 검색·저장 API에서 검사합니다."
              : "변경 시 지갑 서명을 요청하고, 확인된 계약 상태를 반영합니다."}{" "}
            권한 철회는 다음 검색부터 적용됩니다.
          </p>
        </div>
        <select
          aria-label="권한 유효 기간"
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
        >
          <option value={0}>만료 없음</option>
          <option value={3600}>1시간</option>
          <option value={86400}>24시간</option>
          <option value={604800}>7일</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="permission-table">
          <thead>
            <tr>
              <th>MEMORY SCOPE</th>
              {agents.map((a) => (
                <th key={a.id}>
                  <span className={"provider " + a.provider}>
                    {a.provider === "openai" ? "G" : "✳"}
                  </span>
                  {a.name}
                  <small>{a.provider}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scopes.map((s) => (
              <tr key={s}>
                <td>
                  <strong>{scopeLabels[s]}</strong>
                  <small>{s}</small>
                  {s === "personal" && (
                    <span className="tag warning">민감 · 수동 승인</span>
                  )}
                </td>
                {agents.map((a) => {
                  const p = permissions.find(
                    (p) => p.agentId === a.id && p.scope === s,
                  );
                  return (
                    <td key={a.id}>
                      {p && (
                        <>
                          <div className="toggles">
                            {[
                              [1, "READ"],
                              [2, "WRITE"],
                            ].map(([bit, label]) => (
                              <label key={label}>
                                <button
                                  role="switch"
                                  aria-checked={!!(p.bits & Number(bit))}
                                  aria-label={`${a.name} ${s} ${label}`}
                                  disabled={busy}
                                  className={
                                    "toggle " +
                                    (p.bits & Number(bit) ? "on" : "")
                                  }
                                  onClick={() =>
                                    grant(p, p.bits ^ Number(bit), ttl)
                                  }
                                >
                                  <i />
                                </button>
                                {label}
                              </label>
                            ))}
                          </div>
                          <small>
                            {p.expiresAt
                              ? "만료: " +
                                new Date(p.expiresAt * 1000).toLocaleString(
                                  "ko-KR",
                                )
                              : "만료 없음"}
                          </small>
                          <button
                            className="text-danger"
                            disabled={busy || !p.bits}
                            onClick={() => grant(p, 0, 0)}
                          >
                            전체 철회
                          </button>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="info-grid">
        <div>
          <LockKeyhole size={20} />
          <h3>기본값은 접근 차단</h3>
          <p>
            새로 등록한 Agent에게는 권한이 없습니다. 필요한 Scope만 직접
            허용하세요.
          </p>
        </div>
        <div>
          <Fingerprint size={20} />
          <h3>원문은 체인 밖에</h3>
          <p>
            실제 계약에는 권한과 hash만 기록합니다. Scope hash에는 사용자별
            salt를 사용합니다.
          </p>
        </div>
      </div>
    </>
  );
}
function Playground({
  agents,
  health,
  refresh,
  onReview,
}: {
  agents: Row[];
  health: Row;
  refresh: () => Promise<void>;
  onReview: () => void;
}) {
  const [scope, setScope] = useState("development"),
    [project, setProject] = useState("agent-passport"),
    [live, setLive] = useState(false);
  return (
    <>
      <div className="playground-controls">
        <select
          aria-label="채팅 Scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          {scopes.map((s) => (
            <option key={s} value={s}>
              {scopeLabels[s]}
            </option>
          ))}
        </select>
        <input
          aria-label="채팅 프로젝트"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <label className="check-label">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
          />
          실제 API 사용
        </label>
        <span className={"tag " + (live ? "current" : "warning")}>
          {live ? "LIVE API" : "시뮬레이션 · API 호출 없음"}
        </span>
      </div>
      <div className="chat-grid">
        {["openai", "anthropic"].map((provider) => (
          <ChatPanel
            key={provider}
            provider={provider}
            agents={agents.filter((a) => a.provider === provider)}
            scope={scope}
            project={project}
            live={live}
            configured={health.providers[provider]}
            refresh={refresh}
            onReview={onReview}
          />
        ))}
      </div>
      <div className="info-strip">
        <GitMerge size={21} />
        <p>
          GPT에서 기억 후보 생성 → 검토함에서 승인 → Claude의 새 세션에서 질문 →
          접근 권한에서 READ 철회 → 같은 질문의 차단 확인.
        </p>
      </div>
    </>
  );
}
function ChatPanel({
  provider,
  agents,
  scope,
  project,
  live,
  configured,
  refresh,
  onReview,
}: {
  provider: string;
  agents: Row[];
  scope: string;
  project: string;
  live: boolean;
  configured: boolean;
  refresh: () => Promise<void>;
  onReview: () => void;
}) {
  const [agentId, setAgentId] = useState(""),
    [message, setMessage] = useState(""),
    [extract, setExtract] = useState(provider === "openai"),
    [messages, setMessages] = useState<Row[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!agents.some((a) => a.id === agentId)) setAgentId(agents[0]?.id || "");
  }, [agents, agentId]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    const text = message;
    setMessage("");
    setMessages((ms) => [...ms, { role: "user", text }]);
    setBusy(true);
    try {
      const data = await api("/chat", {
        agentId,
        message: text,
        scope,
        project,
        extract,
        live,
      });
      setMessages((ms) => [
        ...ms,
        { role: "assistant", text: data.reply, ...data },
      ]);
      await refresh();
    } catch (e) {
      setMessages((ms) => [
        ...ms,
        {
          role: "error",
          text:
            (e as Error).message === "MEMORY_SCOPE_DENIED"
              ? "접근이 차단되었습니다. 이 Scope의 기억을 읽거나 쓸 권한이 없습니다."
              : (e as Error).message,
        },
      ]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat-panel">
      <header>
        <span className={"provider " + provider}>
          {provider === "openai" ? "G" : "✳"}
        </span>
        <div>
          <strong>
            {provider === "openai" ? "GPT Agent" : "Claude Agent"}
          </strong>
          <small>
            {live
              ? configured
                ? "실제 API 연결 설정됨"
                : "API 키 / 모델 설정 필요"
              : "Demo simulator"}
          </small>
        </div>
        <button
          className="icon-btn"
          aria-label={`${provider} 새 세션`}
          onClick={() => setMessages([])}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {agents.length > 1 && (
        <select
          aria-label={`${provider} Agent 선택`}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <div className="messages">
        {!messages.length && (
          <div className="chat-empty">
            <MessageSquare size={30} />
            <h3>
              {provider === "openai"
                ? "함께 기억을 만들어 보세요."
                : "새로운 세션에서도 이어가세요."}
            </h3>
            <p>
              {provider === "openai"
                ? "결정한 내용을 공통 기억에 제안합니다."
                : "다른 Agent가 남긴 승인된 기억을 검색합니다."}
            </p>
            <button
              onClick={() =>
                setMessage(
                  provider === "openai"
                    ? "백엔드는 Spring Boot, DB는 PostgreSQL로 하자."
                    : "우리 프로젝트 기술 스택 알려줘.",
                )
              }
            >
              {provider === "openai"
                ? "프로젝트 스택 기억하기"
                : "공유된 기술 스택 물어보기"}{" "}
              <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"message " + m.role}>
            <small>
              {m.role === "user"
                ? "YOU"
                : m.role === "error"
                  ? "ACCESS / ERROR"
                  : provider === "openai"
                    ? "GPT"
                    : "CLAUDE"}
            </small>
            <p>{m.text}</p>
            {m.memories?.length > 0 && (
              <div className="citations">
                {m.memories.map((v: Row) => (
                  <span key={v.id}>
                    {v.canonical_key} · v{v.current_version}
                  </span>
                ))}
              </div>
            )}
            {m.trace && (
              <details>
                <summary>도구 호출 추적 · {m.mode}</summary>
                {m.trace.map((t: string) => (
                  <code key={t}>{t}</code>
                ))}
              </details>
            )}
            {m.proposals?.some((p: Row) => p.state === "pending") && (
              <button className="btn" onClick={onReview}>
                기억 후보 검토하기 <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-loading">
            <LoaderCircle className="spin" size={16} />
            권한 확인 · 기억 검색 중…
          </div>
        )}
      </div>
      <form className="chat-input" onSubmit={send}>
        <label className="check-label">
          <input
            type="checkbox"
            checked={extract}
            onChange={(e) => setExtract(e.target.checked)}
          />
          대화에서 기억 후보 추출
        </label>
        <div>
          <textarea
            aria-label={`${provider} 메시지`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Agent에게 메시지를 보내세요…"
            required
            maxLength={10000}
          />
          <button
            aria-label={`${provider} 전송`}
            className="send"
            disabled={busy || !agentId || (live && !configured)}
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
