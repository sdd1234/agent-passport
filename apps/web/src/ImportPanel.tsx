import React, { useState } from "react";
import type { ApiCall } from "./Account";
type Item = {
  title: string;
  content: string;
  source: string;
  sourceKey?: string;
  kind: string;
  projectPath?: string;
  projectName?: string;
  selected: boolean;
  folderId: string;
};
export function ImportPanel({
  api,
  folders,
  onImported,
}: {
  api: ApiCall;
  folders: any[];
  onImported: () => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [defaultFolder, setDefaultFolder] = useState("");
  async function load(file: File) {
    setError("");
    setNotice("");
    if (file.size > 10 * 1024 * 1024) {
      setError("10MB 이하 파일을 선택해 주세요.");
      return;
    }
    try {
      const text = await file.text();
      let raw: any[];
      if (file.name.endsWith(".json")) {
        const bundle = JSON.parse(text);
        if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.entries))
          throw new Error("지원하지 않는 가져오기 파일입니다.");
        raw = bundle.entries;
      } else
        raw = [
          {
            title: file.name,
            content: text,
            source: file.name,
            kind: "memory",
          },
        ];
      if (raw.length > 1000)
        throw new Error("한 번에 최대 1,000개 항목을 가져올 수 있습니다.");
      setItems(
        raw.map((e: any) => {
          if (
            typeof e.title !== "string" ||
            typeof e.content !== "string" ||
            e.content.length > 50000 ||
            e.title.length > 200 ||
            typeof e.source !== "string" ||
            e.source.length > 2000 ||
            (e.projectName !== undefined &&
              (typeof e.projectName !== "string" ||
                e.projectName.length > 120)) ||
            (e.projectPath !== undefined &&
              (typeof e.projectPath !== "string" ||
                e.projectPath.length > 1000)) ||
            (e.sourceKey !== undefined &&
              (typeof e.sourceKey !== "string" || e.sourceKey.length > 100))
          )
            throw new Error("항목 형식 또는 크기를 확인하세요.");
          return {
            ...e,
            kind: [
              "note",
              "decision",
              "progress",
              "todo",
              "session",
              "memory",
            ].includes(e.kind)
              ? e.kind
              : "memory",
            selected: false,
            folderId:
              folders.find(
                (f) =>
                  f.project_path &&
                  f.project_path === e.projectPath &&
                  f.role !== "viewer",
              )?.id || defaultFolder,
          };
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }
  const update = (i: number, p: Partial<Item>) =>
    setItems((old) => old.map((e, n) => (n === i ? { ...e, ...p } : e)));
  async function organize() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const chosen = items
        .map((entry, index) => ({ entry, index }))
        .filter((x) => x.entry.selected);
      if (!chosen.length) throw new Error("분류할 항목을 먼저 선택하세요.");
      const known = [...folders];
      const grouped = new Map<string, string>();
      for (const { entry, index } of chosen) {
        if (entry.folderId) continue;
        const name = (entry.projectName || "").trim();
        if (!name || name === "분류 필요")
          throw new Error(
            "분류가 없는 항목은 프로젝트 이름을 입력하거나 대상 폴더를 선택하세요.",
          );
        const key = entry.projectPath || name;
        let id =
          grouped.get(key) ||
          known.find(
            (f) =>
              f.role === "owner" &&
              entry.projectPath &&
              f.project_path === entry.projectPath,
          )?.id;
        if (!id) {
          const folder = await api("/folders", {
            name: name.slice(0, 120),
            projectPath: entry.projectPath || "",
            parentId: null,
          });
          known.push(folder);
          id = folder.id;
        }
        grouped.set(key, id!);
        update(index, { folderId: id! });
      }
      setNotice(
        "프로젝트별 대상 폴더를 준비했습니다. 내용을 검토한 뒤 서버에 저장하세요.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await onImported();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    let completed = 0;
    try {
      const chosen = items
        .map((entry, index) => ({ entry, index }))
        .filter((x) => x.entry.selected);
      if (!chosen.length) throw new Error("검토한 항목을 선택하세요.");
      if (chosen.some((x) => !x.entry.folderId))
        throw new Error("모든 선택 항목의 대상 폴더를 지정하세요.");
      // One item per request bounds body size and preserves partial progress for retry.
      for (const { entry, index } of chosen) {
        const sourceKey =
          entry.sourceKey ||
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(entry.source + "\0" + entry.content),
              ),
            ),
          )
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
        await api(`/folders/${entry.folderId}/import`, {
          entries: [
            {
              title: entry.title,
              content: entry.content,
              source: entry.source,
              kind: entry.kind,
              sourceKey,
            },
          ],
        });
        update(index, { selected: false, sourceKey });
        completed++;
      }
      await onImported();
      setNotice(
        `${completed}개를 검토 대기 상태로 저장했습니다. 폴더에서 승인하면 에이전트가 읽을 수 있습니다.`,
      );
    } catch (e) {
      setError(
        `${completed}개 저장 후: ${(e as Error).message}. 저장되지 않은 항목을 다시 시도할 수 있습니다.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="import-panel">
      <summary>기존 기억 가져오기</summary>
      <p>
        WSL 터미널에서 아래 명령으로 로컬 파일을 만드세요. 서버로 자동 전송하지
        않습니다.
      </p>
      <pre>
        npm run memory:export -- --output ~/passport-import.json --project
        /작업/프로젝트
      </pre>
      <p>
        대화 기록도 포함하려면 <code>--include-sessions</code>를 추가하세요.
        또는 기억 Markdown 파일을 직접 선택하세요. 비밀정보가 없는지 확인하고
        필요한 항목만 선택하세요.
      </p>
      <label>
        기본 대상 폴더
        <select
          value={defaultFolder}
          onChange={(e) => setDefaultFolder(e.target.value)}
        >
          <option value="">선택</option>
          {folders
            .filter((f) => f.role !== "viewer")
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        가져오기 파일
        <input
          type="file"
          accept=".json,.md,.txt"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) void load(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {items.length > 0 && (
        <>
          <p>
            {items.length}개 항목 · {items.filter((e) => e.selected).length}개
            선택
          </p>
          <button
            disabled={busy || !defaultFolder}
            onClick={() =>
              setItems(
                items.map((e) => ({
                  ...e,
                  folderId: e.selected ? defaultFolder : e.folderId,
                })),
              )
            }
          >
            선택 항목에 기본 폴더 적용
          </button>
          <button disabled={busy} onClick={() => void organize()}>
            선택 항목의 프로젝트별 폴더 만들기
          </button>
          <button
            disabled={busy}
            onClick={() =>
              setItems(items.map((e) => ({ ...e, selected: true })))
            }
          >
            전체 선택
          </button>
          <button
            disabled={busy}
            onClick={() =>
              setItems(items.map((e) => ({ ...e, selected: false })))
            }
          >
            선택 해제
          </button>
          {items.map((e, i) => (
            <details key={i}>
              <summary>
                {e.title} · {e.projectName || "분류 필요"}
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={e.selected}
                  disabled={busy}
                  onChange={(event) =>
                    update(i, { selected: event.target.checked })
                  }
                />
                이 항목 가져오기
              </label>
              <label>
                분류할 프로젝트 이름
                <input
                  disabled={busy}
                  maxLength={120}
                  value={e.projectName || ""}
                  onChange={(event) =>
                    update(i, { projectName: event.target.value })
                  }
                />
              </label>
              <label>
                대상 폴더
                <select
                  aria-label={`대상 폴더 ${i + 1}`}
                  disabled={busy}
                  value={e.folderId}
                  onChange={(event) =>
                    update(i, { folderId: event.target.value })
                  }
                >
                  <option value="">선택</option>
                  {folders
                    .filter((f) => f.role !== "viewer")
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                제목
                <input
                  value={e.title}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => update(i, { title: event.target.value })}
                />
              </label>
              <label>
                가져올 내용
                <textarea
                  aria-label={`가져올 내용 ${i + 1}`}
                  rows={8}
                  value={e.content}
                  disabled={busy}
                  onChange={(event) =>
                    update(i, {
                      content: event.target.value,
                      sourceKey: undefined,
                    })
                  }
                />
              </label>
              <small>출처: {e.source}</small>
            </details>
          ))}
          <button disabled={busy} onClick={() => void submit()}>
            검토한 항목 서버에 저장
          </button>
        </>
      )}
    </details>
  );
}
