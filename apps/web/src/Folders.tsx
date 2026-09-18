import React, { useEffect, useState } from "react";
import { ImportPanel } from "./ImportPanel";
import { FolderEntries } from "./FolderEntries";
import { ReceivePairing, SendPairing } from "./Pairing";
type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  project_path: string;
  handoff: string;
  revision: number;
  role: string;
  entry_count?: number;
  member_count?: number;
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
    [parent, setParent] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [moveParent, setMoveParent] = useState(""),
    [entryKey, setEntryKey] = useState(0),
    [sharing, setSharing] = useState(false),
    [folderSearch, setFolderSearch] = useState("");
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
  async function select(id: string, share = false) {
    setSelected(null);
    setMembers([]);
    setSharing(share);
    const f = await api(`/folders/${id}`);
    setSelected(f);
    setMoveParent(f.parent_id || "");
    if (f.role === "owner") setMembers(await api(`/folders/${id}/members`));
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
  async function save() {
    if (!selected) return;
    setSelected(
      await api(
        `/folders/${selected.id}`,
        {
          name: selected.name,
          projectPath: selected.project_path,
          handoff: selected.handoff,
          revision: selected.revision,
        },
        "PATCH",
      ),
    );
    await refresh();
    setNotice("서버에 저장했습니다.");
  }
  return (
    <section className="folder-workspace">
      <p>
        기억을 가져오면 폴더별로 정리됩니다. 기본은 비공개이며, 원하는 폴더만
        공유할 수 있습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <ImportPanel
        api={api}
        folders={folders}
        onImported={async () => {
          await refresh();
          setEntryKey((k) => k + 1);
        }}
      />
      <div className="folder-tools">
        <details>
          <summary>새 폴더</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const f = await api("/folders", {
                  name,
                  projectPath: "",
                  parentId: parent || null,
                });
                setName("");
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
              상위 폴더
              <select
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
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
        </details>
        <ReceivePairing
          api={api}
          onConnected={async (id) => {
            await refresh();
            await select(id);
          }}
        />
      </div>
      <div className="folder-columns">
        <nav aria-label="프로젝트 폴더 목록">
          <input
            aria-label="폴더 찾기"
            placeholder="폴더 찾기"
            value={folderSearch}
            onChange={(e) => setFolderSearch(e.target.value)}
          />
          {folders.length === 0 && (
            <p>기억 파일이나 폴더를 가져와 시작하세요.</p>
          )}
          {[...folders]
            .filter((f) =>
              folderPath(f)
                .toLocaleLowerCase()
                .includes(folderSearch.toLocaleLowerCase()),
            )
            .sort((a, b) => folderPath(a).localeCompare(folderPath(b), "ko"))
            .map((f) => (
              <div className="folder-card" key={f.id}>
                <button
                  disabled={busy}
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
                <small>
                  기억 {f.entry_count || 0}개 ·{" "}
                  {f.role === "owner"
                    ? f.member_count
                      ? `${f.member_count}명과 공유 중`
                      : "비공개"
                    : "공유받음"}
                </small>
                {f.role === "owner" && (
                  <button
                    className="folder-share-link"
                    aria-label={`${f.name} 공유 설정`}
                    disabled={busy}
                    onClick={() => void run(() => select(f.id, true))}
                  >
                    공유 설정
                  </button>
                )}
              </div>
            ))}
        </nav>
        {selected && (
          <article key={selected.id}>
            <h2>{selected.name}</h2>
            {selected.role === "owner" && (
              <details
                className="folder-sharing"
                open={sharing}
                onToggle={(e) => setSharing(e.currentTarget.open)}
              >
                <summary>
                  폴더 공유 ·{" "}
                  {members.length ? `${members.length}명과 공유 중` : "비공개"}
                </summary>
                <p>
                  이 폴더의 기억과 인수인계 내용만 공유합니다. 다른 폴더는
                  비공개로 유지됩니다.
                </p>
                <SendPairing
                  api={api}
                  folderId={selected.id}
                  onConnected={async () => {
                    setMembers(await api(`/folders/${selected.id}/members`));
                    await refresh();
                  }}
                />
                {members.map((m) => (
                  <p key={m.user_id}>
                    {m.user_id} · {m.role === "editor" ? "편집" : "읽기"}{" "}
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
                          await refresh();
                        })
                      }
                    >
                      공유 철회
                    </button>
                  </p>
                ))}
              </details>
            )}
            <FolderEntries
              key={selected.id + ":" + entryKey}
              api={api}
              folder={selected}
              folders={folders}
            />
            <details className="folder-handoff">
              <summary>
                진행 상황·인수인계 {selected.handoff ? "· 작성됨" : ""}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(save);
                }}
              >
                <label>
                  인수인계 문서
                  <textarea
                    aria-label="인수인계 문서"
                    rows={6}
                    maxLength={50000}
                    disabled={busy || selected.role === "viewer"}
                    placeholder="현재 진행 상황과 다음 작업을 적어 주세요."
                    value={selected.handoff}
                    onChange={(e) =>
                      setSelected({ ...selected, handoff: e.target.value })
                    }
                  />
                </label>
                {selected.role !== "viewer" && (
                  <button disabled={busy}>변경 저장</button>
                )}
              </form>
            </details>
            <details>
              <summary aria-label="폴더 옵션">••• 폴더 옵션</summary>
              {selected.role === "owner" && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(save);
                    }}
                  >
                    <label>
                      이름
                      <input
                        required
                        maxLength={120}
                        value={selected.name}
                        onChange={(e) =>
                          setSelected({ ...selected, name: e.target.value })
                        }
                      />
                    </label>
                    <button disabled={busy}>이름 저장</button>
                  </form>
                  <label>
                    새 상위 폴더
                    <select
                      value={moveParent}
                      onChange={(e) => setMoveParent(e.target.value)}
                    >
                      <option value="">최상위</option>
                      {folders
                        .filter(
                          (f) => f.role === "owner" && f.id !== selected.id,
                        )
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
                      if (window.confirm("폴더와 모든 기억·공유를 삭제할까요?"))
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
                    a.download = "passport-folder.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                }
              >
                폴더 내보내기
              </button>
            </details>
          </article>
        )}
        {!selected && folders.length > 0 && (
          <article className="folder-empty">
            <h2>폴더를 선택하세요</h2>
            <p>
              정리된 기억을 읽거나, 공유 설정에서 이 폴더를 다른 작업자와 연결할
              수 있습니다.
            </p>
          </article>
        )}
      </div>
    </section>
  );
}
