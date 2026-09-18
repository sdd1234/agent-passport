import React, { useEffect, useMemo, useState } from "react";
import { buildOverview } from "./lib/overview.mjs";
import type { ApiCall } from "./Account";
export function FolderEntries({
  api,
  folder,
  folders,
}: {
  api: ApiCall;
  folder: any;
  folders: any[];
}) {
  const [entries, setEntries] = useState<any[]>([]),
    [proposals, setProposals] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [target, setTarget] = useState(""),
    [allEntries, setAllEntries] = useState<any[]>([]),
    [originals, setOriginals] = useState(false);
  const overview = useMemo(() => buildOverview(allEntries), [allEntries]);
  const [visibleRecords, setVisibleRecords] = useState<Record<string, number>>(
    {},
  );
  const prefix = `/folders/${folder.id}`;
  const editable = folder.role !== "viewer";
  async function refresh(start = offset) {
    const [rows, changes] = await Promise.all([
      api(
        `${prefix}/entries?` +
          new URLSearchParams({ query, offset: String(start) }),
      ),
      api(prefix + "/proposals"),
    ]);
    const all: any[] = [];
    for (let page = 0; ; page += 100) {
      const batch = await api(`${prefix}/entries?offset=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    setAllEntries(all);
    setEntries(rows);
    setProposals(changes);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(() => refresh(0));
  }, [folder.id]);
  async function mutate(path: string, body?: unknown, method?: string) {
    await api(prefix + path, body, method);
    await refresh();
  }
  return (
    <section className="folder-entries">
      <h3>프로젝트 한눈에 보기</h3>
      <p className="overview-caption">
        저장된 원문에서 모은 핵심 기록입니다. 출처를 눌러 전체 맥락을
        확인하세요.
      </p>
      {busy && <p role="status">기록을 불러오는 중…</p>}
      {folder.handoff && (
        <div className="handoff-summary">
          <h4>인수인계 메모</h4>
          <p>{folder.handoff}</p>
        </div>
      )}
      <div className="overview-grid">
        {(
          [
            ["goal", "목표와 배경"],
            ["decision", "결정 사항"],
            ["progress", "진행 기록"],
            ["next", "다음 작업"],
          ] as const
        ).map(([key, label], index) => (
          <section className={`overview-card overview-${key}`} key={key}>
            <h4>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </h4>
            {!overview[key].length && (
              <p className="overview-empty">
                원문에 명시된 기록이 아직 없습니다.
              </p>
            )}
            {overview[key].slice(0, 4).map((item, i) => (
              <div className="overview-item" key={i}>
                {item.date && <time>{item.date}</time>}
                <p>{item.text}</p>
                <button
                  className="source-link"
                  onClick={() => {
                    setSelected({
                      ...allEntries.find((e) => e.id === item.entryId),
                    });
                    setHistory([]);
                    setOriginals(true);
                    requestAnimationFrame(() =>
                      document
                        .getElementById("folder-originals")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        }),
                    );
                  }}
                >
                  출처 · {item.title}
                </button>
              </div>
            ))}
            {overview[key].length > 4 && (
              <details
                onToggle={(e) => {
                  if (e.currentTarget.open && !visibleRecords[key])
                    setVisibleRecords((v) => ({ ...v, [key]: 54 }));
                }}
              >
                <summary>기록 {overview[key].length - 4}개 더 보기</summary>
                {overview[key]
                  .slice(4, visibleRecords[key] || 4)
                  .map((item, i) => (
                    <div className="overview-item" key={i}>
                      <p>
                        {item.date && <time>{item.date} · </time>}
                        {item.text}
                      </p>
                      <button
                        className="source-link"
                        onClick={() => {
                          setSelected({
                            ...allEntries.find((e) => e.id === item.entryId),
                          });
                          setHistory([]);
                          setOriginals(true);
                          requestAnimationFrame(() =>
                            document
                              .getElementById("folder-originals")
                              ?.scrollIntoView({ behavior: "smooth" }),
                          );
                        }}
                      >
                        출처 · {item.title}
                      </button>
                    </div>
                  ))}
                {(visibleRecords[key] || 4) < overview[key].length && (
                  <button
                    onClick={() =>
                      setVisibleRecords((v) => ({
                        ...v,
                        [key]: (v[key] || 4) + 50,
                      }))
                    }
                  >
                    기록 50개 더 보기
                  </button>
                )}
              </details>
            )}
          </section>
        ))}
      </div>
      <details
        id="folder-originals"
        open={originals}
        onToggle={(e) => setOriginals(e.currentTarget.open)}
      >
        <summary>원문 {allEntries.length}개 보기</summary>
        {error && <p role="alert">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            void run(() => refresh(0));
          }}
        >
          <label>
            기억 검색
            <input
              value={query}
              maxLength={2000}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button disabled={busy}>검색</button>
        </form>
        <div className="entry-list">
          {entries.map((e) => (
            <button
              disabled={busy}
              key={e.id}
              aria-pressed={selected?.id === e.id}
              onClick={() => {
                setSelected({ ...e });
                setHistory([]);
              }}
            >
              <strong>{e.title}</strong>
              <span>
                {e.kind} ·{" "}
                {e.state === "approved"
                  ? "저장됨"
                  : e.state === "pending"
                    ? "검토 대기"
                    : "거절됨"}{" "}
                · v{e.revision}
              </span>
            </button>
          ))}
        </div>
        <div>
          <button
            disabled={busy || offset === 0}
            onClick={() =>
              void run(async () => {
                const n = Math.max(0, offset - 100);
                setOffset(n);
                await refresh(n);
              })
            }
          >
            이전 항목
          </button>
          <button
            disabled={busy || entries.length < 100}
            onClick={() =>
              void run(async () => {
                const n = offset + 100;
                setOffset(n);
                await refresh(n);
              })
            }
          >
            다음 항목
          </button>
        </div>
        {selected && (
          <div className="entry-detail">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await mutate(
                    `/entries/${selected.id}`,
                    {
                      title: selected.title,
                      content: selected.content,
                      revision: selected.revision,
                    },
                    "PATCH",
                  );
                  setSelected(null);
                });
              }}
            >
              <label>
                기억 제목
                <input
                  required
                  maxLength={200}
                  disabled={!editable}
                  value={selected.title}
                  onChange={(e) =>
                    setSelected({ ...selected, title: e.target.value })
                  }
                />
              </label>
              <label>
                기억 내용
                <textarea
                  aria-label="기억 내용"
                  rows={8}
                  required
                  maxLength={50000}
                  disabled={!editable}
                  value={selected.content}
                  onChange={(e) =>
                    setSelected({ ...selected, content: e.target.value })
                  }
                />
              </label>
              {selected.source && <small>출처: {selected.source}</small>}
              {editable && <button disabled={busy}>기억 수정 저장</button>}
            </form>
            {editable && selected.state === "pending" && (
              <div>
                {[true, false].map((accept) => (
                  <button
                    disabled={busy}
                    key={String(accept)}
                    onClick={() =>
                      void run(async () => {
                        await mutate(`/entries/${selected.id}/review`, {
                          accept,
                          revision: selected.revision,
                        });
                        setSelected(null);
                      })
                    }
                  >
                    {accept ? "기억 승인" : "기억 거절"}
                  </button>
                ))}
              </div>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setHistory(
                    await api(`${prefix}/entries/${selected.id}/versions`),
                  ),
                )
              }
            >
              기억 이력 보기
            </button>
            {history.map((v) => (
              <details key={v.revision}>
                <summary>
                  v{v.revision} · {new Date(v.updated_at).toLocaleString()}
                </summary>
                <pre>{v.content}</pre>
              </details>
            ))}
            {folder.role === "owner" && (
              <div>
                <label>
                  이동할 폴더
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">선택</option>
                    {folders
                      .filter((f) => f.role === "owner" && f.id !== folder.id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  이동한 기억과 이력에는 대상 폴더의 공유 권한이 적용됩니다.
                </p>
                <button
                  disabled={busy || !target}
                  onClick={() =>
                    void run(async () => {
                      await mutate(`/entries/${selected.id}/move`, {
                        folderId: target,
                        revision: selected.revision,
                      });
                      setSelected(null);
                    })
                  }
                >
                  기억 이동
                </button>
              </div>
            )}
            {editable && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm("이 기억과 버전 이력을 삭제할까요?"))
                    void run(async () => {
                      await mutate(
                        `/entries/${selected.id}?revision=${selected.revision}`,
                        undefined,
                        "DELETE",
                      );
                      setSelected(null);
                    });
                }}
              >
                기억 삭제
              </button>
            )}
          </div>
        )}
      </details>
      {proposals.length > 0 && (
        <>
          <h4>에이전트가 제안한 업데이트</h4>
          {proposals.map((p) => (
            <details key={p.id}>
              <summary>{p.entry.title}</summary>
              <pre>{p.entry.content}</pre>
              {editable &&
                [true, false].map((accept) => (
                  <button
                    disabled={busy}
                    key={String(accept)}
                    onClick={() =>
                      void run(() =>
                        mutate(`/proposals/${p.id}/review`, { accept }),
                      )
                    }
                  >
                    {accept ? "업데이트 승인" : "업데이트 거절"}
                  </button>
                ))}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
