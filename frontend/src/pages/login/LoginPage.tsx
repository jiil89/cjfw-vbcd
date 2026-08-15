import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./LoginPage.css";
import { Button, CatLoader, Card, TextInput } from "../../components";
import { HttpError } from "../../api/httpClient";
import { useLoginMutation, useRecoverCjWorldPasswordMutation } from "../../queries/authQueries";
import { useAuthStore } from "../../stores/authStore";

/**
 * 로그인 페이지 — `7-wireframes.md` 2번. CJ WORLD ID + 앱 로그인 비밀번호 입력,
 * 성공 시 세션(Zustand, 메모리만)을 저장하고 Admin 권한 여부에 따라 라우팅한다.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const loginMutation = useLoginMutation();

  const [emailAlias, setEmailAlias] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate(
      { email_alias: emailAlias.trim(), app_password: appPassword },
      {
        onSuccess: (data) => {
          setSession(data.access_token, data.user);
          navigate(data.user.is_admin ? "/admin" : "/chat", { replace: true });
        },
      }
    );
  }

  const statusMessage = getStatusMessage(loginMutation.error);
  const isCjLoginFailed =
    loginMutation.error instanceof HttpError && loginMutation.error.code === "CJ_LOGIN_FAILED";

  return (
    <main className="login-page">
      <div className="login-column">
        <div className="login-brand">
          <div className="login-logo" aria-hidden="true">
            회
          </div>
          <div className="login-brand-text">
            <h1 className="login-title">회의실 예약</h1>
            <p className="login-subtitle">CJ WORLD 계정으로 로그인하세요</p>
          </div>
        </div>

        <Card radius="xl" bordered className="login-card">
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <TextInput
              label="CJ WORLD ID"
              name="email_alias"
              autoComplete="username"
              required
              value={emailAlias}
              onChange={(event) => setEmailAlias(event.target.value)}
            />
            <TextInput
              label="앱 로그인 비밀번호"
              name="app_password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
              labelAction={
                <button
                  type="button"
                  className="text-input-label-action"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? "숨기기" : "표시"}
                </button>
              }
            />

            {statusMessage && (
              <p className="login-status-banner" role="alert">
                {statusMessage}
              </p>
            )}

            {/* CJ WORLD PW가 바뀌면 로그인 자체가 거부되므로(백엔드가 로그인 시점에 CJ 세션을
                확인함) 앱 안의 재등록 화면에는 도달할 수 없다. 그래서 이 경우에만 로그인
                화면에서 바로 재등록할 수 있게 열어준다. */}
            {isCjLoginFailed && (
              <CjWorldPasswordRecovery emailAlias={emailAlias.trim()} appPassword={appPassword} />
            )}

            {loginMutation.isPending && (
              <div className="login-info-banner">
                <CatLoader label="회의실 예약 시스템에 연결하는 중이에요. 조금 걸릴 수 있어요…" />
              </div>
            )}

            <Button
              type="submit"
              className="login-submit"
              loading={loginMutation.isPending}
              disabled={emailAlias.trim() === "" || appPassword === ""}
            >
              로그인
            </Button>
          </form>
        </Card>

        <p className="login-register-link">
          아직 등록하지 않으셨나요? <Link to="/register">회원가입 신청하러 가기</Link>
        </p>
      </div>
    </main>
  );
}

/**
 * CJ WORLD PW 재등록 — 로그인 화면에서만 쓰는 복구 폼.
 * 본인 확인은 위 로그인 폼에 이미 입력한 CJ WORLD ID + 앱 로그인 비밀번호로 하고(서버가
 * 다시 검증한다), 새 CJ WORLD PW는 서버가 실제 CJ 로그인으로 확인한 뒤에만 저장한다.
 */
function CjWorldPasswordRecovery({ emailAlias, appPassword }: { emailAlias: string; appPassword: string }) {
  const [newCjWorldPassword, setNewCjWorldPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const recoverMutation = useRecoverCjWorldPasswordMutation();

  function handleClick() {
    if (newCjWorldPassword === "" || recoverMutation.isPending) return;
    setErrorText(null);
    recoverMutation.mutate(
      { email_alias: emailAlias, app_password: appPassword, new_cj_world_password: newCjWorldPassword },
      {
        onSuccess: () => {
          setNewCjWorldPassword("");
          setIsDone(true);
        },
        onError: (error) => {
          setErrorText(
            error instanceof HttpError ? error.message : "등록 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."
          );
        },
      }
    );
  }

  if (isDone) {
    return (
      <div className="login-recovery">
        <p className="login-recovery-done">새 CJ WORLD PW를 등록했어요. 이제 다시 로그인해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="login-recovery">
      <p className="login-recovery-title">CJ WORLD PW를 바꾸셨나요?</p>
      <p className="login-recovery-hint">
        CJ WORLD에서 비밀번호를 바꾸면 이 앱에도 다시 등록해야 합니다. 새 비밀번호를 넣어주세요.
      </p>
      <input
        type="password"
        className="login-recovery-input"
        placeholder="새 CJ WORLD PW"
        autoComplete="current-password"
        value={newCjWorldPassword}
        onChange={(event) => setNewCjWorldPassword(event.target.value)}
        disabled={recoverMutation.isPending}
      />
      {errorText && <p className="login-recovery-error">{errorText}</p>}
      <Button
        type="button"
        size="sm"
        loading={recoverMutation.isPending}
        disabled={newCjWorldPassword === ""}
        onClick={handleClick}
      >
        {recoverMutation.isPending ? "CJ에서 확인 중…" : "재등록"}
      </Button>
    </div>
  );
}

/**
 * 로그인 실패 상태 메시지 — `7-wireframes.md` 2번이 명시한 3가지 문구를 error.code로
 * 구분해서 그대로 재현한다. 와이어프레임에 없는 ACCOUNT_REVOKED(동의철회) 등은 백엔드
 * 메시지를 그대로 쓴다.
 */
function getStatusMessage(error: unknown): string | null {
  if (!(error instanceof HttpError)) {
    return error ? "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." : null;
  }
  switch (error.code) {
    case "REGISTRATION_PENDING":
      return "관리자 승인을 기다리고 있어요. 승인되면 로그인하실 수 있습니다.";
    case "REGISTRATION_REJECTED":
      return "등록이 거부되었습니다.";
    case "INVALID_CREDENTIALS":
      return "계정 ID 또는 비밀번호를 확인해주세요.";
    case "CJ_LOGIN_FAILED":
      // [2026-08-14] 앱 로그인(app_password)은 통과했지만 실제 CJ WORLD 계정 인증에 실패한
      // 경우 — 백엔드가 로그인 시점에 CJ 세션을 확인해 거부한다(가짜/틀린 CJ 계정으로도
      // 앱에 들어와지던 문제 수정, auth.routes.ts 참고).
      return error.message;
    default:
      return error.message;
  }
}
