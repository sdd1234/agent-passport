import React, { useState } from "react";
import type { ApiCall } from "./Account";
import { organizeEntries } from "./lib/organizer.mjs";
type Item = {
  title: string;
  content: string;
  source: string;
  sourceKey?: string;
  kind: string;
  projectName?: string;
  projectPath?: string;
  group: string;
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<{ name: string; count: number }[]>([]),
    [retry, setRetry] = useState<Item[]>([]);
  async function save(items: Item[]) {
    setBusy(true);
    setError("");
    setRetry(items);
    let saved = 0;
    try {
      const known = [...folders];
      for (const entry of items) {
        let folder = known.find(
          (f) => f.role === "owner" && f.name === entry.group,
        );
        if (!folder) {
          folder = await api("/folders", {
            name: entry.group.slice(0, 120),
            projectPath: "",
            parentId: null,
          });
          known.push(folder);
        }
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
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        await api(`/folders/${folder.id}/import`, {
          entries: [
            {
              title: entry.title,
              content: entry.content,
              source: entry.source,
              sourceKey,
              kind: entry.kind,
            },
          ],
        });
        saved++;
        setRetry(items.slice(saved));
        setNotice(`${saved}/${items.length}개 기억을 정리하고 있습니다.`);
      }
      setNotice(
        `${saved}개 기억을 폴더별로 정리했습니다. 승인 없이 바로 볼 수 있으며, 모든 새 폴더는 비공개입니다.`,
      );
    } catch (e) {
      setError(
        `${saved}개 저장했습니다. ${(e as Error).message.startsWith("PLAN_LIMIT") ? "계정의 저장 한도를 확인해 주세요." : "저장하지 못한 항목을 다시 가져올 수 있습니다."}`,
      );
    } finally {
      try {
        await onImported();
      } catch {
        setError("저장 결과를 불러오지 못했습니다. 새로고침해 주세요.");
      }
      setBusy(false);
    }
  }
  async function load(files: FileList | null) {
    if (!files?.length) return;
    const fileCount = files.length;
    setBusy(true);
    setError("");
    setNotice("파일 내용을 읽고 비슷한 기억을 묶고 있습니다.");
    setResult([]);
    try {
      if ([...files].reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024)
        throw Error("한 번에 10MB 이하로 가져와 주세요.");
      const raw: any[] = [];
      for (const file of Array.from(files)) {
        if (!/\.(json|md|txt)$/i.test(file.name)) continue;
        const text = await file.text();
        if (file.name.endsWith(".json")) {
          const b = JSON.parse(text);
          if (b.schemaVersion !== 1 || !Array.isArray(b.entries))
            throw Error("지원하는 기억 내보내기 파일을 선택하세요.");
          if (b.folder?.name) {
            if (fileCount !== 1)
              throw Error("공유 폴더 파일은 한 번에 하나씩 가져와 주세요.");
            await api("/folders/import-copy", b);
            setNotice(
              `‘${b.folder.name}’ 폴더를 내 비공개 사본으로 가져왔습니다. 원본과 자동 동기화되지 않습니다.`,
            );
            await onImported();
            return;
          }
          raw.push(...b.entries);
        } else {
          const relative = file.webkitRelativePath || file.name;
          const folder = relative.includes("/")
            ? relative.split("/").slice(0, -1).join(" / ")
            : "";
          for (let start = 0; start < text.length;) {
            let end = Math.min(start + 30000, text.length);
            if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]))
              end--;
            raw.push({
              title:
                file.name +
                (text.length > 30000
                  ? ` · ${Math.floor(start / 30000) + 1}`
                  : ""),
              content: text.slice(start, end),
              source: relative,
              kind: "memory",
              projectName: folder,
            });
            start = end;
          }
        }
      }
      if (!raw.length || raw.length > 1000)
        throw Error(
          "기억 파일은 한 번에 1~1,000개 항목까지 가져올 수 있습니다.",
        );
      for (const e of raw) {
        if (
          typeof e.title !== "string" ||
          !e.title.trim() ||
          e.title.length > 200 ||
          typeof e.content !== "string" ||
          !e.content.trim() ||
          e.content.length > 50000 ||
          typeof e.source !== "string" ||
          e.source.length > 2000 ||
          (e.sourceKey !== undefined &&
            (typeof e.sourceKey !== "string" || e.sourceKey.length > 100)) ||
          (e.projectName !== undefined &&
            (typeof e.projectName !== "string" ||
              e.projectName.length > 120)) ||
          (e.projectPath !== undefined &&
            (typeof e.projectPath !== "string" || e.projectPath.length > 1000))
        )
          throw Error("파일의 기억 형식이나 크기를 확인해 주세요.");
        if (
          ![
            "note",
            "decision",
            "progress",
            "todo",
            "session",
            "memory",
          ].includes(e.kind)
        )
          e.kind = "memory";
      }
      const organized = organizeEntries(raw);
      setResult(
        organized.groups.map((g) => ({
          name: g.name,
          count: g.entries.length,
        })),
      );
      await save(organized.entries as Item[]);
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="import-panel">
      <h3>기억 가져오기</h3>
      <p>
        파일이나 폴더를 선택하면 내용을 읽어 프로젝트·주제별로 정리합니다.
        가져온 뒤 폴더를 옮기거나 원하는 폴더만 공유하세요.
      </p>
      <div className="import-actions">
        <label className="import-picker">
          파일 가져오기
          <input
            aria-label="가져오기 파일"
            type="file"
            multiple
            accept=".json,.md,.txt"
            disabled={busy}
            onChange={(e) => {
              void load(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="import-picker">
          폴더 가져오기
          <input
            aria-label="가져오기 폴더"
            type="file"
            multiple
            {...{ webkitdirectory: "" }}
            disabled={busy}
            onChange={(e) => {
              void load(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && retry.length > 0 && (
        <button onClick={() => void save(retry)}>
          남은 {retry.length}개 다시 가져오기
        </button>
      )}
      {result.length > 0 && (
        <details>
          <summary>자동 정리 결과 · {result.length}개 폴더</summary>
          {result.map((g) => (
            <p key={g.name}>
              {g.name} · {g.count}개
            </p>
          ))}
        </details>
      )}
      <details>
        <summary>Claude·Codex 기억 파일 찾기</summary>
        <p>
          Claude의 memory 폴더, 프로젝트의 MEMORY.md·CLAUDE.md 또는 내보낸 JSON
          파일을 선택하세요. WSL 파일은 실행 중인 Linux 브라우저의 파일 선택
          창에서 열 수 있습니다.
        </p>
        <p>명령으로 내보내려면 프로젝트에서 아래 명령을 실행하세요.</p>
        <pre>npm run memory:export -- --output ~/passport-import.json</pre>
      </details>
    </section>
  );
}
