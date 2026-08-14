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
      <div className="register-column">
        <div className="register-brand">
          <div className="register-logo" aria-hidden="true">
            회
          </div>
          <div className="register-brand-text">
            <h1 className="register-title">계정 등록 신청</h1>
            <p className="register-subtitle">승인까지 보통 1영업일이 걸려요</p>
          </div>
        </div>

        <Card radius="xl" bordered className="register-card">
          <form className="register-form" onSubmit={handleSubmit} noValidate>
            <section className="register-section">
              <h2 className="register-section-title">
                <span className="register-section-number">1</span>
                사내 계정
              </h2>
              <p className="register-section-warning">
                실제로 존재하는 CJ 사내 계정인지는 별도로 확인하지 않아요. 잘못된 ID·비밀번호를 입력하면
                승인되어도 회의실 예약 기능이 동작하지 않습니다.
              </p>
              <TextInput
                label="계정 ID"
                name="email_alias"
                autoComplete="username"
                required
                helpText="메일 주소 앞부분이에요. @회사도메인은 빼고 입력하세요."
                value={emailAlias}
                onChange={(event) => setEmailAlias(event.target.value)}
              />
              <TextInput
                label="계정 비밀번호"
                name="corporate_password"
                type="password"
                autoComplete="new-password"
                required
                helpText="예약 자동화 로그인에만 쓰이고 암호화 저장됩니다."
                value={corporatePassword}
                onChange={(event) => setCorporatePassword(event.target.value)}
              />
            </section>

            <section className="register-section">
              <h2 className="register-section-title">
                <span className="register-section-number">2</span>
                선호 회의실
                <span className="register-section-optional">선택</span>
              </h2>
              <PreferredRoomPicker
                rooms={roomsQuery.data ?? []}
                isLoading={roomsQuery.isLoading}
                loadError={roomsQuery.isError}
                value={preferredRoomIds}
                onChange={setPreferredRoomIds}
              />
            </section>

            <section className="register-section">
              <h2 className="register-section-title">
                <span className="register-section-number">3</span>
                앱 로그인 비밀번호
              </h2>
              <p className="register-section-hint">사내 계정 비밀번호와 다른 값을 쓰세요. 해시로 저장됩니다.</p>
              <div className="register-password-row">
                <TextInput
                  label="비밀번호"
                  name="app_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={appPassword}
                  onChange={(event) => setAppPassword(event.target.value)}
                />
                <TextInput
                  label="비밀번호 확인"
                  name="app_password_confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  errorMessage={passwordsMismatch ? "두 비밀번호가 서로 달라요" : undefined}
                  success={passwordsMatch}
                  helpText={passwordsMatch ? "비밀번호가 일치해요" : undefined}
                  value={appPasswordConfirm}
                  onChange={(event) => setAppPasswordConfirm(event.target.value)}
                  onBlur={() => setConfirmTouched(true)}
                />
              </div>
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
        </Card>

        <p className="register-login-link">
          이미 승인된 계정이 있으신가요? <Link to="/login">로그인하러 가기</Link>
        </p>
      </div>
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
      <div className="register-column">
        <Card radius="xl" bordered className="register-card register-confirmation">
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
      </div>
    </main>
  );
}
