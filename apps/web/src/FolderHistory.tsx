import React, { useState } from "react";
import type { ApiCall } from "./Account";
const actions: Record<string, string> = {
  CREATE: "추가",
  EDIT: "수정",
  DELETE: "삭제",
  MOVE: "이동",
  REVIEW: "승인 상태 변경",
  RESTORE: "이전 상태 복원",
  CLAIM: "작업 담당",
  UPDATE: "진행 보고",
  RELEASE: "담당 해제",
  COPY: "사본 가져오기",
};
const types: Record<string, string> = {
  folder: "폴더",
  entry: "기억",
  task: "작업",
};
const fields: Record<string, string> = {
  name: "폴더 이름",
  handoff: "인수인계",
  title: "제목",
  content: "내용",
  kind: "종류",
  state: "승인 상태",
  status: "작업 상태",
  description: "설명",
  progress: "진행 보고",
  work_scope: "작업 영역",
  revision: "버전",
  location: "폴더 위치",
};
function Snapshot({ value }: { value: any }) {
  return value ? (
    <dl>
      {Object.entries(value)
        .filter(([k]) => k !== "revision")
        .map(([key, v]) => (
          <div key={key}>
            <dt>{fields[key] || key}</dt>
            <dd>
              <pre>
                {(key === "status"
                  ? (
                      {
                        todo: "대기",
                        active: "진행 중",
                        blocked: "도움 필요",
                        done: "완료",
                      } as Record<string, string>
                    )[String(v)]
                  : key === "state"
                    ? (
                        {
                          approved: "저장됨",
                          pending: "검토 대기",
                          rejected: "제외됨",
                        } as Record<string, string>
                      )[String(v)]
                    : key === "kind"
                      ? (
                          {
                            note: "메모",
                            decision: "결정",
                            progress: "진행",
                            todo: "할 일",
                            session: "대화",
                            memory: "기억",
                          } as Record<string, string>
                        )[String(v)]
                      : null) || String(v ?? "")}
              </pre>
            </dd>
          </div>
        ))}
    </dl>
  ) : (
    <p>존재하지 않음 · 삭제된 상태</p>
  );
}
export function FolderHistory({
  api,
  folder,
  onRestored,
}: {
  api: ApiCall;
  folder: any;
  onRestored: () => Promise<void>;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0);
  const base = `/folders/${folder.id}/history`;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const code = (e as Error).message;
      setError(
        (
          {
            HISTORY_VERSION_CONFLICT:
              "다른 작업자가 변경했습니다. 상세를 다시 열어 최신 상태를 확인하세요.",
            RELEASE_TASK_FIRST: "진행 중인 작업은 담당을 해제한 뒤 복원하세요.",
            RESTORE_SOURCE_CONFLICT:
              "같은 출처의 기억이 이미 존재합니다. 해당 기억을 확인하세요.",
            FOLDER_ACCESS_DENIED: "이 변경을 복원할 권한이 없습니다.",
            FOLDER_CYCLE: "폴더 구조가 바뀌어 그 위치로 복원할 수 없습니다.",
          } as Record<string, string>
        )[code] || "이력을 처리하지 못했습니다. 권한과 저장 용량을 확인하세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  const load = async (page = 0) => {
    setRows(await api(`${base}?offset=${page}`));
    setOffset(page);
  };
  const restore = async (side: "before" | "after") => {
    if (!confirm("선택한 상태로 복원할까요? 현재 변경도 이력에 보존됩니다."))
      return;
    await run(async () => {
      await api(`${base}/${detail.event.id}/restore`, {
        side,
        expectedRevision: detail.expectedRevision,
        expectedHead: detail.expectedHead,
      });
      setDetail(null);
      await onRestored();
      await load();
    });
  };
  return (
    <details
      className="folder-history"
      onToggle={(e) => {
        if (e.currentTarget.open) void run(() => load());
      }}
    >
      <summary>변경 이력 · 복원</summary>
      <p>
        누가 무엇을 바꿨는지 확인하고 이전 상태로 되돌릴 수 있습니다. 복원도 새
        이력으로 남습니다. 공유 권한과 로컬 경로는 바뀌지 않습니다.
      </p>
      <button disabled={busy} onClick={() => void run(() => load())}>
        이력 새로고침
      </button>
      {error && <p role="alert">{error}</p>}
      {!rows.length && !busy && (
        <p>
          아직 변경 이력이 없습니다. 이 기능 적용 이후의 변경부터 기록됩니다.
        </p>
      )}
      <ol className="history-list">
        {rows.map((e) => (
          <li key={e.id}>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => setDetail(await api(`${base}/${e.id}`)))
              }
            >
              <strong>
                {types[e.entity_type]} · {actions[e.action] || e.action}
              </strong>
              <span>
                {e.actor_name} ·{" "}
                {new Date(e.created_at).toLocaleString("ko-KR")} · v
                {e.entity_revision}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="history-pages">
        <button
          disabled={busy || offset === 0}
          onClick={() => void run(() => load(offset - 50))}
        >
          이전 이력 페이지
        </button>
        <button
          disabled={busy || rows.length < 50}
          onClick={() => void run(() => load(offset + 50))}
        >
          다음 이력 페이지
        </button>
      </div>
      {detail && (
        <section className="history-detail">
          <h3>
            {types[detail.event.type]} 변경 비교 · {detail.event.actor}
          </h3>
          <p>
            현재{" "}
            {detail.moved
              ? "다른 폴더로 이동된 상태"
              : detail.expectedRevision
                ? `v${detail.expectedRevision}`
                : "삭제된 상태"}
            입니다. 선택한 이전 상태로 복원하면 새 버전으로 기록합니다.
          </p>
          {detail.current && (
            <details>
              <summary>현재 내용 확인</summary>
              <Snapshot value={detail.current} />
            </details>
          )}
          <div className="history-comparison">
            <article>
              <h4>변경 전</h4>
              <Snapshot value={detail.before} />
              {detail.canRestore &&
                (detail.before || detail.event.type !== "folder") && (
                  <button disabled={busy} onClick={() => restore("before")}>
                    변경 전으로 복원
                  </button>
                )}
            </article>
            <article>
              <h4>변경 후</h4>
              <Snapshot value={detail.after} />
              {detail.canRestore &&
                (detail.after || detail.event.type !== "folder") && (
                  <button disabled={busy} onClick={() => restore("after")}>
                    변경 후로 복원
                  </button>
                )}
            </article>
          </div>
          {detail.event.type === "task" && (
            <p>
              진행 중이던 상태를 복원하면 담당 예약을 해제하고 대기 상태로
              돌립니다.
            </p>
          )}
        </section>
      )}
    </details>
  );
}
