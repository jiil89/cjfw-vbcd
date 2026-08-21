# CJFW-VBCD — 사내 회의실 예약 챗봇

자연어 대화로 사내 회의실을 조회·예약·변경·취소하는 웹 챗봇입니다. 회원가입/로그인,
Admin 승인 패널, 챗봇 UI로 구성됩니다.

## 문서

개발 과정에서 작성한 문서는 전부 `docs/` 디렉토리에 있습니다.

| 문서 | 내용 |
|---|---|
| [`docs/1-domain-definition-meeting-room-agent.md`](docs/1-domain-definition-meeting-room-agent.md) | 도메인 정의서(최상위 source of truth) — 온보딩 플로우, 유스케이스, 비즈니스 규칙, 예약 시스템 API 명세 |
| [`docs/2-usecase.md`](docs/2-usecase.md) | 유스케이스 정의서 — 액터별 상호작용 흐름(UC-01~16), 기본/대안 흐름과 사전·사후조건 |
| [`docs/3-service-scenarios.md`](docs/3-service-scenarios.md) | 사용자 시나리오(사용자 관점의 이야기) |
| [`docs/4-prd.md`](docs/4-prd.md) | PRD — 인프라 구성, 인증/보안 결정사항, 진행 상태 |
| [`docs/5-project-principle.md`](docs/5-project-principle.md) | 코드 구현 구조 원칙 — 레이어 의존 방향, 네이밍, 폴더 구조, 보안/설정 원칙 |
| [`docs/6-arch-diagram.md`](docs/6-arch-diagram.md) | 시스템 아키텍처 Mermaid 다이어그램 |
| [`docs/7-wireframes.md`](docs/7-wireframes.md) | 화면별 와이어프레임(회원가입/로그인/Admin/챗봇, 데스크톱+모바일) |
| [`docs/8-erd.md`](docs/8-erd.md) | DB ERD(Mermaid), 테이블별 설명 |
| [`docs/9-plan.md`](docs/9-plan.md) | 실행계획 — DB/백엔드/프론트 Task 분해, 진행 기록 |
| [`docs/laptop-server-setup.md`](docs/laptop-server-setup.md) | 운영 배포 절차서(정본) |
| [`e2e/e2e-20260821-vercel-study.md`](e2e/e2e-20260821-vercel-study.md) | E2E 테스트 결과 |
| [`docs/swagger.json`](docs/swagger.json) | 백엔드 API 계약(OpenAPI 3.0) |

## Demo Site

**Frontend**: https://cjfw-vbcd-f7ff.vercel.app

> ⚠️ **이 데모는 메인 화면(회원가입/로그인 화면 UI, 정적 페이지)까지만 정상 동작합니다.**
> 이 서비스는 사내망 전용인 회의실 예약 시스템과 연동하는데, 그 시스템이 사내망
> 밖에서는 접근 자체가 불가능합니다. 그래서 이 클라우드 데모에서는 **로그인 시도 시
> 항상 실패**합니다(`CJ_LOGIN_FAILED`, 정상적으로 예상되는 동작입니다 — 실제 사내
> 노트북 서버에 배포했을 때만 로그인/예약까지 전부 동작합니다. 절차는
> [`docs/laptop-server-setup.md`](docs/laptop-server-setup.md) 참고).
> DB(회원가입, 승인 상태 등)는 운영 데이터와 분리된 실습용 Supabase 프로젝트에
> 연결돼 있어 실제로 회원가입/승인 흐름까지는 확인할 수 있습니다.

## 테스트용 계정

| 구분 | 계정 ID(email_alias) | 비밀번호(app_password) | 비고 |
|---|---|---|---|
| 관리자 | `jiil` | `testAppPw123!` | 화이트리스트 자동승인 계정, `is_admin=true` |
| 일반 사용자 | `test_user002` | `testAppPw123!` | Admin 승인 처리 완료된 일반 계정 |

두 계정 모두 로그인 폼까지는 정상 진입하지만, 위 안내대로 로그인 시도 자체는
`CJ_LOGIN_FAILED`로 실패합니다(서버가 사내망에 도달할 수 없어서).

## 테스트 시나리오

1. Demo Site 접속 → 메인/로그인 화면이 정상적으로 뜨는지 확인.
2. 로그인 화면에서 위 계정으로 로그인 시도 → `CJ WORLD 계정 인증에 실패했습니다` 메시지와 함께
   실패하는 것을 확인(예상된 동작).
3. 회원가입 화면에서 새 계정(예: `email_alias=demo123`)으로 가입 신청 →
   화이트리스트에 없는 계정이므로 "승인 대기(pending)" 상태로 접수됨을 확인.
4. 이미 등록된 계정(`jiil`)으로 다시 가입 신청 → 중복 가입 방지(409) 확인.
5. 그 외 회원가입/로그인 폼의 유효성 검사(빈 값, 형식 오류 등) UI 동작 확인.

실제 예약 생성/조회 같은 챗봇 핵심 기능은 사내 노트북 배포 환경에서만 검증
가능합니다. 자세한 E2E 테스트 기록은 [`e2e/e2e-20260821-vercel-study.md`](e2e/e2e-20260821-vercel-study.md)를 참고하세요.
