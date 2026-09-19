import React, { useEffect, useState } from "react";
import type { ApiCall } from "./Account";
const taskErrors: Record<string, string> = {
  TASK_VERSION_CONFLICT:
    "다른 작업자가 먼저 변경했습니다. 최신 상태를 확인한 뒤 다시 시도하세요.",
  TASK_ALREADY_CLAIMED: "이미 다른 에이전트가 맡은 작업입니다.",
  WORK_SCOPE_BUSY: "겹치는 작업 영역을 다른 작업에서 사용 중입니다.",
  TASK_LEASE_EXPIRED:
    "담당 시간이 만료됐습니다. 작업을 다시 맡은 뒤 진행하세요.",
  CLAIM_TASK_FIRST: "먼저 작업을 맡아 주세요.",
  TASK_NOT_ASSIGNEE: "현재 담당자만 진행 내용을 변경할 수 있습니다.",
  TASK_LIMIT_200: "폴더의 작업 200개 한도입니다. 완료한 작업을 정리해 주세요.",
  USE_RELATIVE_WORK_SCOPE: "작업 영역은 apps/web처럼 상대 경로로 입력하세요.",
};
const labels: Record<string, string> = {
  todo: "대기",
  active: "작업 중",
  blocked: "도움 필요",
  done: "완료",
};
export function CollaborationBoard({
  api,
  folder,
}: {
  api: ApiCall;
  folder: any;
}) {
  const [tasks, setTasks] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [scope, setScope] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [agents, setAgents] = useState<any[]>([]),
    [grants, setGrants] = useState<any[]>([]),
    [provider, setProvider] = useState("claude"),
    [token, setToken] = useState(""),
    [issuedProvider, setIssuedProvider] = useState(""),
    [events, setEvents] = useState<Record<string, any[]>>({});
  const prefix = `/folders/${folder.id}`,
    editable = folder.role !== "viewer";
  const load = async () => setTasks(await api(prefix + "/tasks"));
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const rows = await api(prefix + "/tasks");
        if (alive) {
          setTasks(rows);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setTasks([]);
          setError((e as Error).message);
        }
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [folder.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function connections() {
    setAgents(await api("/agents"));
    setGrants(await api(prefix + "/agent-grants"));
  }
  const change = (t: any, action: string, status?: string) =>
    run(async () => {
      await api(
        prefix + "/tasks/" + t.id,
        {
          action,
          revision: t.revision,
          ...(status ? { status, progress: drafts[t.id] ?? t.progress } : {}),
        },
        "PATCH",
      );
      setDrafts((v) => {
        const n = { ...v };
        delete n[t.id];
        return n;
      });
    });
  return (
    <section className="collaboration-board">
      <div className="timeline-toolbar">
        <div>
          <h3>작업 · 인수인계</h3>
          <p>
            작업을 나눠 맡고 진행 내용을 공유합니다. 화면은 5초마다 갱신됩니다.
          </p>
        </div>
        <span>
          {
            tasks.filter((t) => t.status === "active" && !t.lease_expired)
              .length
          }
          개 진행 중
        </span>
      </div>
      {error && <p role="alert">{taskErrors[error] || error}</p>}
      {editable && (
        <details>
          <summary>작업 추가</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(prefix + "/tasks", {
                  title,
                  description,
                  workScope: scope,
                });
                setTitle("");
                setDescription("");
                setScope("");
              });
            }}
          >
            <label>
              작업 제목
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              작업 설명
              <textarea
                maxLength={8000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              작업 영역
              <input
                maxLength={500}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="예: apps/web 또는 apps/api"
              />
            </label>
            <small>
              영역을 비우면 프로젝트 전체를 맡습니다. 같은 영역의 동시 작업을
              막으며 실제 파일을 잠그지는 않습니다.
            </small>
            <button disabled={busy}>작업 등록</button>
          </form>
        </details>
      )}
      {!tasks.length && (
        <p className="timeline-note">
          작업 내용과 진행 상황을 남기면 다음 Claude 또는 Codex가 이어받을 수
          있습니다.
        </p>
      )}
      <div className="collaboration-tasks">
        {tasks.map((t) => (
          <details key={t.id} className="collaboration-task">
            <summary>
              <span className={`timeline-badge ${t.status}`}>
                {t.lease_expired ? "담당 만료" : labels[t.status]}
              </span>
              <strong>{t.title}</strong>
              <small>
                {t.actor_name || "담당 없음"} ·{" "}
                {t.work_scope || "프로젝트 전체"}
              </small>
            </summary>
            <p>{t.description}</p>
            <p className="task-progress">
              {t.progress || "아직 진행 보고가 없습니다."}
            </p>
            {t.lease_until > 0 && (
              <small>
                담당 유지: {new Date(t.lease_until).toLocaleTimeString()}까지 ·
                진행 보고 시 30분 연장
              </small>
            )}
            {editable && (
              <div>
                {(t.status === "todo" ||
                  t.status === "blocked" ||
                  t.lease_expired) && (
                  <button
                    disabled={busy}
                    onClick={() => void change(t, "claim")}
                  >
                    내가 맡기
                  </button>
                )}
                {t.status === "active" && (
                  <>
                    <label>
                      진행 보고
                      <textarea
                        maxLength={8000}
                        value={drafts[t.id] ?? t.progress}
                        onChange={(e) =>
                          setDrafts((v) => ({ ...v, [t.id]: e.target.value }))
                        }
                      />
                    </label>
                    <div className="task-actions">
                      {[
                        ["active", "진행 공유"],
                        ["blocked", "도움 요청"],
                        ["done", "작업 완료"],
                      ].map(([status, label]) => (
                        <button
                          key={status}
                          disabled={busy}
                          onClick={() => void change(t, "update", status)}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "현재 담당을 해제하고 다른 작업자가 맡도록 할까요?",
                            )
                          )
                            void change(t, "release");
                        }}
                      >
                        담당 해제
                      </button>
                    </div>
                  </>
                )}
                {["todo", "done"].includes(t.status) && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm("이 작업과 진행 이력을 삭제할까요?"))
                        void run(async () => {
                          await api(
                            prefix + "/tasks/" + t.id,
                            undefined,
                            "DELETE",
                          );
                        });
                    }}
                  >
                    작업 삭제
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() =>
                void run(async () => {
                  const rows = await api(prefix + "/tasks/" + t.id + "/events");
                  setEvents((v) => ({ ...v, [t.id]: rows }));
                })
              }
            >
              최근 진행 이력
            </button>
            {events[t.id]?.map((e) => (
              <p key={e.id}>
                <small>
                  {new Date(e.created_at).toLocaleString()} · {labels[e.status]}
                </small>
                <br />
                {e.progress || "담당 변경"}
              </p>
            ))}
          </details>
        ))}
      </div>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open)
            void connections().catch((e) => setError(e.message));
        }}
      >
        <summary>Claude·Codex 협업 연결</summary>
        <p>
          각 도구를 별도 에이전트로 연결하세요. 같은 토큰을 함께 쓰면 담당자를
          구분할 수 없습니다.
        </p>
        <label>
          새 연결
          <select
            aria-label="새 연결"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const a = await api("/agents", {
                provider: "mcp",
                name: provider === "claude" ? "Claude 협업" : "Codex 협업",
              });
              setToken(a.token);
              setIssuedProvider(provider);
              await api(prefix + "/agent-grants", {
                agentId: a.id,
                bits: editable ? 3 : 1,
              });
              await connections();
            })
          }
        >
          연결 키 발급
        </button>
        {token && (
          <div>
            <label>
              연결 키 · 한 번만 표시
              <input type="password" readOnly value={token} />
            </label>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(token)
                  .catch(() => setError("클립보드 복사에 실패했습니다."))
              }
            >
              연결 키 복사
            </button>
            <p>로컬 터미널에서 연결 키를 입력한 뒤 아래 설정을 실행하세요.</p>
            <pre>{`read -rs PASSPORT_AGENT_TOKEN; export PASSPORT_AGENT_TOKEN\nnpm run client:setup -- --provider ${issuedProvider}\nunset PASSPORT_AGENT_TOKEN\nnode scripts/launch-client.mjs ${issuedProvider}`}</pre>
            <button onClick={() => setToken("")}>키를 보관했습니다</button>
          </div>
        )}
        {agents.map((a) => (
          <label key={a.id}>
            {a.name}
            <select
              aria-label={a.name}
              disabled={busy}
              value={grants.find((g) => g.agent_id === a.id)?.bits || 0}
              onChange={(e) =>
                void run(async () => {
                  await api(prefix + "/agent-grants", {
                    agentId: a.id,
                    bits: Number(e.target.value),
                  });
                  await connections();
                })
              }
            >
              <option value={0}>접근 차단</option>
              <option value={1}>읽기</option>
              {editable && <option value={3}>협업 허용</option>}
            </select>
          </label>
        ))}
        <p>각 도구에 아래 작업 지침을 전달하세요.</p>
        <pre>{`폴더 ${folder.id}에서 협업한다.\nget_folder_context와 get_folder_tasks로 최신 상태를 읽는다.\n작업 전 claim_folder_task로 겹치지 않는 영역을 맡는다.\nupdate_folder_task로 진행 보고와 인수인계를 남긴다.\n30분 전에 갱신하며 담당 만료나 충돌 시 수정을 멈춘다.\n서로 다른 worktree에서 작업하고 병합 전에 검토한다.`}</pre>
      </details>
    </section>
  );
}
