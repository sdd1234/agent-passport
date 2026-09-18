import React, { useEffect, useState } from "react";
import type { ApiCall } from "./Account";
const messages: Record<string, string> = {
  PAIRING_INVALID_OR_EXPIRED:
    "공유 코드가 만료되었거나 취소되었습니다. 새 코드를 요청하세요.",
  PAIRING_ALREADY_USED: "이미 사용한 코드입니다. 새 코드를 발급해 주세요.",
  PAIRING_ALREADY_CLAIMED:
    "다른 계정이 연결을 요청했습니다. 보내는 쪽에서 취소 후 새 코드를 발급하세요.",
  PAIRING_CODE_MISMATCH: "공유 코드가 일치하지 않습니다.",
  PAIRING_DIFFERENT_ACCOUNT_REQUIRED:
    "받는 PC에서는 다른 작업자의 계정으로 로그인하세요.",
  PAIRING_RECEIVER_REQUIRED: "받는 PC에서 먼저 코드를 입력해 주세요.",
  TRY_LATER: "시도 횟수가 많습니다. 10분 후 다시 시도하세요.",
  PLAN_LIMIT_SHARES:
    "공유 한도를 초과했습니다. 기존 공유 또는 요금제를 확인하세요.",
};
const message = (e: unknown) =>
  messages[(e as Error).message] ||
  "연결하지 못했습니다. 서버 연결과 공유 한도를 확인하세요.";
const clean = (s: string) => s.replace(/[\s-]/g, "");
function useStatus(api: ApiCall, id: string) {
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setStatus(null);
    setError("");
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api(`/pairings/${id}`);
        if (!active) return;
        setStatus(next);
        setError("");
        if (!["complete", "expired"].includes(next.state))
          timer = setTimeout(poll, 1500);
      } catch (e) {
        if (active) setError(message(e));
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, api]);
  return { status, error };
}
export function ReceivePairing({
  api,
  onConnected,
}: {
  api: ApiCall;
  onConnected: (id: string) => Promise<void>;
}) {
  const [code, setCode] = useState(""),
    [id, setId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { status, error: pollError } = useStatus(api, id);
  useEffect(() => {
    if (status?.state === "complete") {
      setId("");
      setCode("");
      void onConnected(status.folderId).catch((e) => setError(message(e)));
    }
  }, [status]);
  return (
    <details>
      <summary>일회용 코드로 공유받기</summary>
      <p>
        같은 서버에 각자의 계정으로 로그인하세요. 받은 12자리 코드를 입력하면
        보내는 PC의 확인을 기다립니다.
      </p>
      {(error || pollError) && <p role="alert">{error || pollError}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api("/pairings/join", { code: clean(code) });
            setId(r.id);
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          받은 공유 코드
          <input
            required
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{12}"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(clean(e.target.value))}
          />
        </label>
        <button disabled={busy}>연결 요청</button>
      </form>
      {status?.state === "ready" && (
        <p role="status">
          보내는 PC에서 상대 계정과 코드를 확인하면 연결됩니다.
        </p>
      )}
      {status?.state === "expired" && (
        <p role="alert">코드가 만료되었습니다. 새 코드를 요청하세요.</p>
      )}
    </details>
  );
}
export function SendPairing({
  api,
  folderId,
  onConnected,
}: {
  api: ApiCall;
  folderId: string;
  onConnected: () => Promise<void>;
}) {
  const [pair, setPair] = useState<any>(null),
    [role, setRole] = useState("viewer"),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { status, error: pollError } = useStatus(api, pair?.id || "");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="일회용 코드 공유">
      <h3>일회용 코드로 폴더 공유</h3>
      <p>
        코드를 상대에게 전달하세요. 상대의 계정 이름을 확인한 뒤, 이 PC에서도
        같은 코드를 입력하면 공유됩니다. 하위 폴더는 포함되지 않습니다.
      </p>
      {(error || pollError) && <p role="alert">{error || pollError}</p>}
      <label>
        공유 권한
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={!!pair}
        >
          <option value="viewer">읽기</option>
          <option value="editor">편집</option>
        </select>
      </label>
      {!pair && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setPair(await api("/pairings", { folderId, role }));
              setCode("");
            })
          }
        >
          공유 코드 발급
        </button>
      )}
      {pair && (
        <>
          <label>
            발급된 공유 코드
            <input readOnly value={pair.code} />
          </label>
          <p>
            유효 기한: {new Date(pair.expiresAt).toLocaleTimeString()} (10분, 한
            번만 사용)
          </p>
          {status?.state === "waiting" && (
            <p role="status">받는 PC의 코드 입력을 기다리는 중입니다.</p>
          )}
          {status?.state === "ready" && (
            <p role="status">
              연결 요청 계정: <strong>{status.receiver}</strong> ·{" "}
              {status.role === "editor" ? "편집" : "읽기"}
            </p>
          )}
          {status?.state === "expired" && (
            <p role="alert">코드가 만료되었습니다. 취소 후 새로 발급하세요.</p>
          )}
          {status?.state !== "complete" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(`/pairings/${pair.id}/confirm`, {
                    code: clean(code),
                  });
                  setCode("");
                  setPair(null);
                  await onConnected();
                });
              }}
            >
              <label>
                보내는 PC 코드 확인
                <input
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{12}"
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(clean(e.target.value))}
                />
              </label>
              <button disabled={busy || status?.state !== "ready"}>
                상대 확인 후 공유 연결
              </button>
            </form>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`/pairings/${pair.id}`, undefined, "DELETE");
                setPair(null);
                setCode("");
              })
            }
          >
            코드 취소
          </button>
        </>
      )}
    </section>
  );
}
