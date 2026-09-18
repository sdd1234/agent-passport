import React, { useEffect, useState } from "react";
import type { ApiCall } from "./Account";
export function FolderConnections({
  api,
  folder,
}: {
  api: ApiCall;
  folder: any;
}) {
  const [agents, setAgents] = useState<any[]>([]),
    [grants, setGrants] = useState<any[]>([]),
    [bindings, setBindings] = useState<any[]>([]),
    [path, setPath] = useState(""),
    [name, setName] = useState(""),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const prefix = `/folders/${folder.id}`;
  async function load() {
    const [a, g, b] = await Promise.all([
      api("/agents"),
      api(prefix + "/agent-grants"),
      api("/folders/bindings"),
    ]);
    setAgents(a);
    setGrants(g);
    setBindings(b.filter((v: any) => v.folder_id === folder.id));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {});
  }, [folder.id]);
  return (
    <details>
      <summary>고급 설정 · Codex · Claude 자동 연결</summary>
      {error && <p role="alert">{error}</p>}
      <p>
        공유받은 프로젝트도 내 컴퓨터의 작업 폴더에 연결할 수 있습니다. 아래
        접근 허용은 내 에이전트에만 적용됩니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api(prefix + "/binding", { localPath: path });
            setPath("");
          });
        }}
      >
        <label>
          내 작업 폴더 경로
          <input
            required
            placeholder="/home/me/project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <button disabled={busy}>작업 폴더 연결</button>
      </form>
      {bindings.map((b) => (
        <p key={b.local_path}>
          {b.local_path}{" "}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(
                  prefix +
                    "/binding?" +
                    new URLSearchParams({ localPath: b.local_path }),
                  undefined,
                  "DELETE",
                );
              })
            }
          >
            연결 해제
          </button>
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const a = await api("/agents", { provider: "mcp", name });
            setToken(a.token);
            setName("");
          });
        }}
      >
        <label>
          새 에이전트 이름
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button disabled={busy}>연결 토큰 발급</button>
      </form>
      {token && (
        <div>
          <p>
            토큰은 한 번만 표시됩니다. 로컬 설정에 보관하고 공유하지 마세요.
          </p>
          <code className="recovery-code">{token}</code>
          <button onClick={() => setToken("")}>토큰 숨기기</button>
        </div>
      )}
      {agents.map((a) => (
        <label key={a.id}>
          {a.name}
          <select
            aria-label={`${a.name} 폴더 권한`}
            disabled={busy}
            value={grants.find((g) => g.agent_id === a.id)?.bits || 0}
            onChange={(e) =>
              void run(async () => {
                await api(prefix + "/agent-grants", {
                  agentId: a.id,
                  bits: Number(e.target.value),
                });
              })
            }
          >
            <option value={0}>차단</option>
            <option value={1}>읽기</option>
            {folder.role !== "viewer" && (
              <option value={3}>읽기 + 업데이트 제안</option>
            )}
          </select>
        </label>
      ))}
      <p>
        로컬 저장소에서 <code>npm run client:setup</code>을 실행해 서버 주소와
        토큰을 저장한 다음, 실제 작업 폴더에서{" "}
        <code>
          node /설치경로/agent-passport/scripts/launch-client.mjs codex
        </code>{" "}
        또는 <code>claude</code>로 실행하세요.
      </p>
      <p>
        에이전트에게 “get_folder_context로 이 프로젝트를 읽고 작업해 줘. 진행
        상황은 propose_folder_memory로 제안해 줘”라고 요청하세요. 새 기억은 GUI
        승인 후 공유됩니다.
      </p>
    </details>
  );
}
