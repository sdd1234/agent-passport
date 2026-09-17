import React, { useState, useEffect } from "react";
export type ApiCall = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<any>;
export function AccountLogin({
  api,
  onLogin,
}: {
  api: ApiCall;
  onLogin: (owner: string) => Promise<void>;
}) {
  const [mode, setMode] = useState("login"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [recovery, setRecovery] = useState(""),
    [code, setCode] = useState(""),
    [newOwner, setNewOwner] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="account-panel">
      <h3>내 계정으로 시작</h3>
      {error && <p role="alert">{error}</p>}
      {code ? (
        <>
          <p>
            복구 코드는 한 번만 표시됩니다. 비밀번호를 잊었을 때 필요하므로
            안전한 곳에 보관하세요.
          </p>
          <code className="recovery-code">{code}</code>
          <button
            className="btn primary"
            onClick={() => {
              setCode("");
              if (newOwner) void onLogin(newOwner);
              else setMode("login");
            }}
          >
            복구 코드를 보관했습니다
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api("/account/" + mode, {
                username,
                password,
                ...(mode === "recover" ? { recoveryCode: recovery } : {}),
              });
              setPassword("");
              if (r.recoveryCode) {
                setCode(r.recoveryCode);
                setNewOwner(r.owner || "");
              } else await onLogin(r.owner);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            사용자 이름
            <input
              required
              autoComplete="username"
              pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}"
              placeholder="영문·숫자·밑줄 3~64자"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          {mode === "recover" && (
            <label>
              복구 코드
              <input
                required
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              />
            </label>
          )}
          <label>
            {mode === "recover" ? "새 비밀번호" : "비밀번호"}
            <input
              required
              type="password"
              minLength={12}
              maxLength={200}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy} className="btn primary">
            {mode === "login"
              ? "로그인"
              : mode === "register"
                ? "계정 만들기"
                : "비밀번호 재설정"}
          </button>
          <div className="account-actions">
            {[
              ["login", "로그인"],
              ["register", "회원가입"],
              ["recover", "계정 복구"],
            ]
              .filter(([m]) => m !== mode)
              .map(([m, l]) => (
                <button
                  type="button"
                  key={m}
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setMode(m);
                    setError("");
                  }}
                >
                  {l}
                </button>
              ))}
          </div>
        </form>
      )}
    </div>
  );
}
export function BillingPanel({ api }: { api: ApiCall }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/billing")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function open(kind: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/billing/" + kind, {});
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw new Error("결제 URL을 확인할 수 없습니다.");
      window.location.assign(url.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="folder-workspace">
      <h2>요금제와 사용량</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            현재 요금제:{" "}
            <strong>{data.usage.plan === "pro" ? "Pro" : "Free"}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>사용량</th>
                <th>한도</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["folders", "폴더"],
                ["entries", "기억"],
                ["shares", "폴더 공유"],
                ["storedBytes", "저장량 (암호화·이력 포함 바이트)"],
              ].map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{data.usage[key].toLocaleString()}</td>
                  <td>{data.usage.limits[key].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.checkoutEnabled && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/billing/sync", {});
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              결제 공급자 상태 다시 확인
            </button>
          )}
          {data.checkoutEnabled ? (
            <>
              <p>
                가격과 청구 주기는 결제 화면에서 확인할 수 있습니다. 결제
                공급자의 확인을 받은 뒤 요금제가 반영됩니다.
              </p>
              <button disabled={busy} onClick={() => void open("checkout")}>
                Pro 결제 화면 열기
              </button>
              <button disabled={busy} onClick={() => void open("portal")}>
                구독 관리 · 해지
              </button>
            </>
          ) : (
            <p>유료 결제는 아직 운영자가 활성화하지 않았습니다.</p>
          )}
          <button disabled={busy} onClick={() => void load()}>
            사용량 새로고침
          </button>
          <p>
            한도를 넘으면 추가 저장이 제한됩니다. 기존 데이터는
            읽기·내보내기·삭제할 수 있습니다.
          </p>
        </>
      )}
    </section>
  );
}

export function AccountSettings({
  api,
  onDeleted,
}: {
  api: ApiCall;
  onDeleted: () => void;
}) {
  const [me, setMe] = useState<any>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api("/account")
      .then(setMe)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <details className="account-panel">
      <summary>내 계정 · 데이터 관리</summary>
      {error && <p role="alert">{error}</p>}
      {me && (
        <>
          <p>사용자 이름: {me.username}</p>
          <p>
            공유용 계정 ID: <code>{me.owner}</code>
          </p>
        </>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const data = await api("/account/export");
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "passport-account-export.json";
            a.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        내 데이터 내보내기
      </button>
      <p>
        탈퇴하면 내 폴더와 기록·공유·토큰이 삭제됩니다. 다른 사람 소유 폴더에
        작성한 문서는 해당 소유자의 자료로 남습니다. 구독 중이면 먼저 구독을
        해지하고 종료가 반영된 뒤 탈퇴하세요.
      </p>
      <label>
        탈퇴 확인 비밀번호
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !password}
        onClick={async () => {
          if (!window.confirm("내 계정과 소유한 모든 자료를 영구 삭제할까요?"))
            return;
          setBusy(true);
          setError("");
          try {
            await api(
              "/account",
              { password, confirmation: "DELETE" },
              "DELETE",
            );
            onDeleted();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        계정과 내 데이터 삭제
      </button>
    </details>
  );
}
