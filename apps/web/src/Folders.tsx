import React, { useEffect, useState } from "react";
import { ImportPanel } from "./ImportPanel";
import { FolderEntries } from "./FolderEntries";
import { FolderConnections } from "./FolderConnections";
type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  project_path: string;
  handoff: string;
  revision: number;
  role: string;
};
type Member = { user_id: string; role: string };
export function Folders({
  api,
}: {
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
}) {
  const [folders, setFolders] = useState<Folder[]>([]),
    [selected, setSelected] = useState<Folder | null>(null),
    [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [parent, setParent] = useState(""),
    [user, setUser] = useState(""),
    [role, setRole] = useState("viewer"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [moveParent, setMoveParent] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [invites, setInvites] = useState<any[]>([]),
    [entryKey, setEntryKey] = useState(0);
  const [inviteToken, setInviteToken] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get("invite") || "",
  );
  const refresh = async () => setFolders(await api("/folders"));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (/FOLDER_(ACCESS_DENIED|NOT_FOUND)/.test((e as Error).message))
        setSelected(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(refresh);
  }, []);
  async function select(id: string) {
    setSelected(null);
    setMembers([]);
    setInvites([]);
    setInviteUrl("");
    const f = await api(`/folders/${id}`);
    setSelected(f);
    setMoveParent(f.parent_id || "");
    if (f.role === "owner") {
      setMembers(await api(`/folders/${id}/members`));
      setInvites(await api(`/folders/${id}/invites`));
    }
  }
  function folderPath(folder: Folder) {
    const parts = [folder.name],
      seen = new Set([folder.id]);
    let parent = folder.parent_id;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const item = folders.find((f) => f.id === parent);
      if (!item) break;
      parts.unshift(item.name);
      parent = item.parent_id;
    }
    return parts.join(" / ");
  }
  return (
    <section className="folder-workspace">
      <p>
        프로젝트 폴더와 인수인계 문서를 서버에 저장합니다. 공유는 선택한
        폴더에만 적용됩니다. 하위 폴더는 별도로 공유하세요.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <details open={!!inviteToken}>
        <summary>초대받은 폴더 연결</summary>
        <label>
          초대 링크 또는 코드
          <input
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !inviteToken}
          onClick={() =>
            void run(async () => {
              const token = inviteToken.includes("#invite=")
                ? inviteToken.split("#invite=")[1]
                : inviteToken;
              const result = await api("/folders/accept-invite", { token });
              setInviteToken("");
              window.history.replaceState(null, "", window.location.pathname);
              await refresh();
              await select(result.folderId);
            })
          }
        >
          초대 수락
        </button>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const f = await api("/folders", {
              name,
              projectPath: path,
              parentId: parent || null,
            });
            setName("");
            setPath("");
            await refresh();
            await select(f.id);
          });
        }}
      >
        <label>
          폴더 이름
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          로컬 프로젝트 경로
          <input
            maxLength={1000}
            placeholder="/home/me/project (선택)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <label>
          상위 폴더
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">최상위</option>
            {folders
              .filter((f) => f.role === "owner")
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy}>폴더 만들기</button>
      </form>
      <ImportPanel
        api={api}
        folders={folders}
        onImported={async () => {
          await refresh();
          setEntryKey((k) => k + 1);
        }}
      />
      <div className="folder-columns">
        <nav aria-label="프로젝트 폴더 목록">
          {folders.length === 0 && <p>첫 프로젝트 폴더를 만들어 주세요.</p>}
          {[...folders]
            .sort((a, b) => folderPath(a).localeCompare(folderPath(b), "ko"))
            .map((f) => (
              <button
                disabled={busy}
                key={f.id}
                aria-pressed={selected?.id === f.id}
                onClick={() => void run(() => select(f.id))}
              >
                {folderPath(f)} ·{" "}
                {f.role === "owner"
                  ? "내 폴더"
                  : f.role === "editor"
                    ? "공유 · 편집"
                    : "공유 · 읽기"}
              </button>
            ))}
        </nav>
        {selected && (
          <article>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const f = await api(
                    `/folders/${selected.id}`,
                    {
                      name: selected.name,
                      projectPath: selected.project_path,
                      handoff: selected.handoff,
                      revision: selected.revision,
                    },
                    "PATCH",
                  );
                  setSelected(f);
                  await refresh();
                  setNotice("서버에 저장했습니다.");
                });
              }}
            >
              <label>
                이름
                <input
                  required
                  maxLength={120}
                  disabled={busy || selected.role === "viewer"}
                  value={selected.name}
                  onChange={(e) =>
                    setSelected({ ...selected, name: e.target.value })
                  }
                />
              </label>
              {selected.role === "owner" && (
                <label>
                  연결할 프로젝트 경로
                  <input
                    maxLength={1000}
                    value={selected.project_path}
                    onChange={(e) =>
                      setSelected({ ...selected, project_path: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                인수인계 문서
                <textarea
                  aria-label="인수인계 문서"
                  rows={14}
                  maxLength={50000}
                  disabled={busy || selected.role === "viewer"}
                  placeholder="목표와 배경&#10;현재 진행 상황&#10;결정 사항과 근거&#10;다음 작업&#10;막힌 점과 참고 자료"
                  value={selected.handoff}
                  onChange={(e) =>
                    setSelected({ ...selected, handoff: e.target.value })
                  }
                />
              </label>
              <p>
                버전 {selected.revision} · 다른 작업자의 변경과 충돌하면 다시
                열어 확인하세요.
              </p>
              {selected.role !== "viewer" && (
                <button disabled={busy}>변경 저장</button>
              )}
            </form>
            {selected.role === "owner" && (
              <>
                <h3>폴더 위치와 내보내기</h3>
                <label>
                  새 상위 폴더
                  <select
                    value={moveParent}
                    onChange={(e) => setMoveParent(e.target.value)}
                  >
                    <option value="">최상위</option>
                    {folders
                      .filter((f) => f.role === "owner" && f.id !== selected.id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/folders/${selected.id}/move`, {
                        parentId: moveParent || null,
                        revision: selected.revision,
                      });
                      await refresh();
                      await select(selected.id);
                    })
                  }
                >
                  폴더 이동
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "폴더와 모든 기억·공유를 삭제할까요? 하위 폴더는 먼저 이동하거나 삭제해야 합니다.",
                      )
                    )
                      void run(async () => {
                        await api(
                          `/folders/${selected.id}?revision=${selected.revision}`,
                          undefined,
                          "DELETE",
                        );
                        setSelected(null);
                        await refresh();
                      });
                  }}
                >
                  폴더 삭제
                </button>
                <h3>폴더 공유</h3>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const invite = await api(
                        `/folders/${selected.id}/invites`,
                        { role },
                      );
                      setInviteUrl(invite.url);
                      setInvites(await api(`/folders/${selected.id}/invites`));
                    })
                  }
                >
                  현재 권한으로 초대 링크 만들기
                </button>
                {inviteUrl && (
                  <>
                    <p>
                      24시간 동안 한 번 사용할 수 있는 링크입니다. 받을 사람에게
                      직접 전달하세요.
                    </p>
                    <input aria-label="초대 링크" readOnly value={inviteUrl} />
                  </>
                )}
                {invites.map((invite) => (
                  <p key={invite.id}>
                    {invite.role} ·{" "}
                    {new Date(invite.expires_at).toLocaleString()}까지{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/folders/${selected.id}/invites/${invite.id}`,
                            undefined,
                            "DELETE",
                          );
                          setInvites(
                            await api(`/folders/${selected.id}/invites`),
                          );
                        })
                      }
                    >
                      초대 취소
                    </button>
                  </p>
                ))}
                <p>
                  이미 가입한 사용자의 계정 ID로 공유합니다. 데모 계정은 모든
                  방문자가 같은 계정을 사용하므로 개인 간 공유 검증에는 개별
                  로그인이 필요합니다.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await api(`/folders/${selected.id}/members`, {
                        userId: user,
                        role,
                      });
                      setMembers(await api(`/folders/${selected.id}/members`));
                      setUser("");
                    });
                  }}
                >
                  <label>
                    사용자 계정 ID
                    <input
                      required
                      maxLength={80}
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </label>
                  <label>
                    권한
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="viewer">읽기</option>
                      <option value="editor">편집</option>
                    </select>
                  </label>
                  <button disabled={busy}>공유 적용</button>
                </form>
                {members.map((m) => (
                  <p key={m.user_id}>
                    {m.user_id} · {m.role}{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/folders/${selected.id}/members/${encodeURIComponent(m.user_id)}`,
                            undefined,
                            "DELETE",
                          );
                          setMembers(
                            await api(`/folders/${selected.id}/members`),
                          );
                        })
                      }
                    >
                      공유 철회
                    </button>
                  </p>
                ))}
              </>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await api(`/folders/${selected.id}/export`);
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "passport-folder-export.json";
                  a.click();
                  URL.revokeObjectURL(url);
                })
              }
            >
              폴더 내보내기
            </button>
            <FolderConnections
              key={selected.id + "connections"}
              api={api}
              folder={selected}
            />
            <FolderEntries
              key={selected.id + ":" + entryKey}
              api={api}
              folder={selected}
              folders={folders}
            />
          </article>
        )}
      </div>
    </section>
  );
}
