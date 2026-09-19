import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type SaveStatus = {
  state: string;
  saved: number;
  pending: number;
  lastSavedAt: number;
  code: string;
  malformed: number;
};
type Api = (path: string, body?: unknown, method?: string) => Promise<any>;
const messages: Record<string, string> = {
  AUTOSAVE_PENDING:
    "이전 작업 기록을 저장 중입니다. 저장이 완료되면 다시 시작하세요.",
  TERMINAL_ALREADY_RUNNING:
    "진행 중인 터미널이 있습니다. 작업을 종료한 뒤 다른 도구로 이어받으세요.",
  TERMINAL_NOT_CONFIGURED: "이 PC의 터미널 계정을 먼저 설정해야 합니다.",
  TERMINAL_ACCESS_DENIED:
    "이 PC에서 작업하도록 설정된 계정만 터미널을 사용할 수 있습니다.",
  WORKSPACE_UNAVAILABLE:
    "연결된 작업 폴더를 찾을 수 없습니다. 폴더 연결을 확인해 주세요.",
};
export function WorkTerminal({
  folderId,
  api,
}: {
  folderId: string;
  api: Api;
}) {
  const [open, setOpen] = useState(false),
    [provider, setProvider] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [autosave, setAutosave] = useState<SaveStatus | null>(null);
  const lastSaved = useRef(0);
  const acceptSave = (value: SaveStatus) => {
    setAutosave(value);
    if (value.lastSavedAt > lastSaved.current) {
      lastSaved.current = value.lastSavedAt;
      window.dispatchEvent(
        new CustomEvent("passport-memory-saved", { detail: { folderId } }),
      );
    }
  };
  useEffect(() => {
    let cancelled = false,
      loading = false;
    const poll = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const data = await api(`/local/work?folderId=${folderId}`);
        if (!cancelled && data.autosave) acceptSave(data.autosave);
      } catch {
        /* Non-PC servers have no local collector. */
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [folderId]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!provider || !host.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      convertEol: false,
      theme: { background: "#15171b" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/local/work/socket`,
    );
    const resize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
    };
    ws.onopen = () => {
      resize();
      term.focus();
      setStatus("실제 CLI 터미널에 연결되었습니다.");
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "autosave" && m.folderId === folderId)
        acceptSave(m.status);
      if (m.type === "output") term.write(m.data);
      if (m.type === "exit") {
        setStatus(
          `작업 종료 (코드 ${m.exitCode}). 다른 도구로 이어받을 수 있습니다.`,
        );
        term.write(
          "\r\n[CLI가 종료되었습니다. 작업 종료를 누르면 다른 도구로 이어받을 수 있습니다.]\r\n",
        );
      }
    };
    ws.onclose = () =>
      setStatus(
        "터미널 연결이 닫혔습니다. 작업하기를 눌러 다시 연결할 수 있습니다.",
      );
    const input = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "input", data }));
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => {
      ws.onclose = null;
      ws.close();
      observer.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [provider]);
  const show = async () => {
    setBusy(true);
    setOpen(true);
    setError("");
    try {
      const s = await api(`/local/work?folderId=${folderId}`);
      if (s.autosave) acceptSave(s.autosave);
      if (s.folderId === folderId) setProvider(s.provider);
      else if (s.folderId) setError(messages.TERMINAL_ALREADY_RUNNING);
    } catch (e) {
      setError(
        messages[(e as Error).message] ||
          "이 서버에서는 PC 터미널을 사용할 수 없습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const start = async (p: string) => {
    setBusy(true);
    setError("");
    try {
      await api("/local/work", { folderId, provider: p });
      setProvider(p);
    } catch (e) {
      setError(
        messages[(e as Error).message] || "터미널을 실행하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="work-terminal">
      <button className="btn primary" onClick={show}>
        작업하기
      </button>
      {autosave && (
        <div className="autosave-status" role="status">
          <strong>
            {autosave.state === "error"
              ? "자동 저장 확인 필요"
              : autosave.state === "pending"
                ? "자동 저장 재시도 중"
                : autosave.state === "saved"
                  ? `자동 저장 완료 · ${autosave.saved}개 기록`
                  : autosave.state === "waiting"
                    ? "대화 기록을 기다리는 중"
                    : "대화 자동 저장 켜짐"}
          </strong>
          <span>
            {autosave.state === "error"
              ? autosave.code === "TRANSCRIPT_NOT_FOUND"
                ? "CLI 대화 기록을 찾지 못했습니다. 이 세션은 아직 자동 저장되지 않았습니다."
                : "서버 저장에 실패했습니다. 로컬 대기 기록을 유지하고 다시 시도합니다. 로그인·폴더 권한·저장 용량을 확인하세요."
              : "작업하기로 시작한 대화를 이 폴더에 자동 저장합니다. 공유 폴더의 참여자도 읽을 수 있습니다."}
          </span>
          {autosave.lastSavedAt > 0 && (
            <small>
              마지막 저장{" "}
              {new Date(autosave.lastSavedAt).toLocaleTimeString("ko-KR")}
              {autosave.pending > 0 ? ` · ${autosave.pending}개 대기` : ""}
            </small>
          )}
          {autosave.malformed > 0 && (
            <small>
              읽을 수 없는 기록 {autosave.malformed}줄이 있어 일부 내용은
              저장되지 않았습니다.
            </small>
          )}
        </div>
      )}
      {open && (
        <div className="work-terminal-panel">
          <h3>이 폴더에서 작업 이어가기</h3>
          <p>
            Claude 또는 Codex가 폴더의 기억과 진행 상황을 읽고 실제 CLI에서
            작업합니다. 대화는 자동 저장되어 날짜별 작업 타임라인에 정리됩니다.
            작업을 종료한 뒤 다른 도구로 이어받을 수 있습니다.
          </p>
          {!provider && (
            <div className="actions">
              <button disabled={busy} onClick={() => start("claude")}>
                Claude로 작업
              </button>
              <button disabled={busy} onClick={() => start("codex")}>
                Codex로 작업
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          {provider && (
            <>
              <strong>
                {provider === "claude" ? "Claude" : "Codex"} · 실제 터미널
              </strong>
              <div
                ref={host}
                className="terminal-screen"
                aria-label="작업 터미널"
              />
              <button
                onClick={async () => {
                  if (
                    !confirm(
                      "실행 중인 CLI를 종료할까요? 마지막 대화도 자동 저장합니다.",
                    )
                  )
                    return;
                  try {
                    const result = await api(
                      `/local/work?folderId=${folderId}`,
                      undefined,
                      "DELETE",
                    );
                    if (result.autosave) acceptSave(result.autosave);
                    setProvider("");
                    setStatus("작업을 종료했습니다.");
                  } catch {
                    setError("작업을 종료하지 못했습니다. 다시 시도하세요.");
                  }
                }}
              >
                작업 종료
              </button>
            </>
          )}
          <p role="status">{busy ? "터미널을 시작하고 있습니다…" : status}</p>
        </div>
      )}
    </section>
  );
}
