import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./RegisterPage.css";
import { Button, Card, TextInput } from "../../components";
import { HttpError } from "../../api/httpClient";
import { useRegisterMutation, useRoomsQuery } from "../../queries/registrationQueries";
import type { RegisterResponse } from "../../types/registration";
import { PreferredRoomPicker } from "./PreferredRoomPicker";

/**
 * 회원가입 웹페이지 — `7-wireframes.md` 1번. 공개(anon) 화면, 로그인 불필요.
 * 데스크톱/모바일 모두 TextInput의 기본 상단-라벨 레이아웃을 그대로 써서 단일 컬럼으로
 * 구성한다(새 2컬럼 폼 레이아웃을 만들지 않고 FE-1 공용 컴포넌트를 그대로 조합).
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const roomsQuery = useRoomsQuery();
  const registerMutation = useRegisterMutation();

  const [emailAlias, setEmailAlias] = useState("");
  const [corporatePassword, setCorporatePassword] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [appPasswordConfirm, setAppPasswordConfirm] = useState("");
  const [preferredRoomIds, setPreferredRoomIds] = useState<string[]>([]);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const confirmFilled = appPasswordConfirm.length > 0;
  const passwordsMatch = confirmFilled && appPassword === appPasswordConfirm;
  const passwordsMismatch = confirmTouched && confirmFilled && !passwordsMatch;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmTouched(true);

    if (appPassword !== appPasswordConfirm) {
      return;
    }

    registerMutation.mutate({
      email_alias: emailAlias.trim(),
      corporate_password: corporatePassword,
      app_password: appPassword,
      preferred_room_ids: preferredRoomIds.filter((id) => id !== ""),
    });
  }

  if (registerMutation.isSuccess) {
    return <RegistrationConfirmation result={registerMutation.data} onGoToLogin={() => navigate("/login")} />;
  }

  const submitError =
    registerMutation.error instanceof HttpError
      ? registerMutation.error.message
      : registerMutation.isError
        ? "등록 신청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
        : null;

  return (
    <main className="register-page">
      <Card radius="xl" className="register-card">
        <h1 className="register-title">회의실 예약 — 계정 등록 신청</h1>

        <form className="register-form" onSubmit={handleSubmit} noValidate>
          <section className="register-section">
            <h2 className="register-section-title">사내 계정 정보</h2>
            <TextInput
              label="사내 계정 ID (email_alias)"
              name="email_alias"
              autoComplete="username"
              required
              value={emailAlias}
              onChange={(event) => setEmailAlias(event.target.value)}
            />
            <TextInput
              label="사내 계정 비밀번호"
              name="corporate_password"
              type="password"
              autoComplete="new-password"
              required
              helpText="CJ 자동화 로그인용으로 암호화 저장됩니다."
              value={corporatePassword}
              onChange={(event) => setCorporatePassword(event.target.value)}
            />
          </section>

          <section className="register-section">
            <PreferredRoomPicker
              rooms={roomsQuery.data ?? []}
              isLoading={roomsQuery.isLoading}
              loadError={roomsQuery.isError}
              value={preferredRoomIds}
              onChange={setPreferredRoomIds}
            />
          </section>

          <section className="register-section">
            <h2 className="register-section-title">이 앱 로그인 정보</h2>
            <TextInput
              label="앱 로그인 비밀번호"
              name="app_password"
              type="password"
              autoComplete="new-password"
              required
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
            />
            <TextInput
              label="앱 로그인 비밀번호 확인"
              name="app_password_confirm"
              type="password"
              autoComplete="new-password"
              required
              helpText="사내 계정 비밀번호와 별개 값입니다. 해시로 저장됩니다."
              errorMessage={passwordsMismatch ? "비밀번호가 일치하지 않습니다." : undefined}
              success={passwordsMatch}
              value={appPasswordConfirm}
              onChange={(event) => setAppPasswordConfirm(event.target.value)}
              onBlur={() => setConfirmTouched(true)}
            />
          </section>

          {submitError && (
            <p className="register-error-banner" role="alert">
              {submitError}
            </p>
          )}

          <Button type="submit" className="register-submit" loading={registerMutation.isPending}>
            등록 신청
          </Button>
        </form>

        <p className="register-login-link">
          이미 승인된 계정이 있으신가요? <Link to="/login">로그인하러 가기</Link>
        </p>
      </Card>
    </main>
  );
}

interface RegistrationConfirmationProps {
  result: RegisterResponse;
  onGoToLogin: () => void;
}

function RegistrationConfirmation({ result, onGoToLogin }: RegistrationConfirmationProps) {
  const isAutoApproved = result.status === "auto_approved";

  return (
    <main className="register-page">
      <Card radius="xl" className="register-card register-confirmation">
        <h1 className="register-title">등록 신청이 접수되었습니다.</h1>
        <p className="register-confirmation-lead">승인되면 로그인하실 수 있어요.</p>
        <p className="register-confirmation-branch">
          {isAutoApproved
            ? "화이트리스트 대상으로 확인되어 자동 승인되었습니다. 바로 로그인하실 수 있어요."
            : "화이트리스트 대상이 아니어서 관리자 승인 후 이용하실 수 있어요."}
        </p>
        <Button className="register-submit" onClick={onGoToLogin}>
          로그인 페이지로 이동
        </Button>
      </Card>
    </main>
  );
}
