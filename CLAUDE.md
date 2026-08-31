# CJFW-VBCD 프로젝트의 최상위 지침

## 반드시 준수할 최우선 지침

- 모든 대화는 한국어로 할 것
- 오버엔지니어링 금지
- 응답은 사용자가 쉽게 이해할 수 있게 할 것

## 개발할 때 다음 사항을 준수할 것

- 안드레 카파시의 CLAUDE.md
- https://raw.githubusercontent.com/multica-ai/andrej-karpathy-skills/refs/heads/main/CLAUDE.md
- Ponytail (게으른 시니어 개발자 모드 — 필요한지부터 따지고, 있는 걸 재사용하고, 최소한만 작성)
- https://raw.githubusercontent.com/dietrichgebert/ponytail/main/AGENTS.md

## 프로젝트 문서 참조 (source of truth)

작업 전 관련 문서를 먼저 확인할 것. 규칙/구조가 바뀌면 문서를 먼저 고치고 코드를 따라 고친다.

- `docs/1-domain-definition-meeting-room-agent.md` — 도메인 정의서(최상위 source of truth). 온보딩 플로우, 유스케이스, 비즈니스 규칙, §9 예약 시스템 API 명세
- `docs/2-usecase.md` — 유스케이스 정의서. 액터별 상호작용 흐름(UC-01~16), 기본/대안 흐름과 사전·사후조건. 1번이 "무엇이 참인가"라면 이 문서는 "어떻게 동작하는가"
- `docs/3-service-scenarios.md` — 사용자 시나리오 (사용자 관점의 이야기)
- `docs/4-prd.md` — PRD. 인프라 구성(사내 노트북 서버 + Supabase), 인증/보안(JWT access+refresh) 결정사항, 진행 상태
- `docs/5-project-principle.md` — 코드 구현 시 반드시 따라야 할 구조 원칙(레이어 의존 방향, 네이밍, 폴더 구조, 보안/설정 원칙)
- `docs/6-arch-diagram.md` — 시스템 아키텍처 Mermaid 다이어그램
- `docs/7-wireframes.md` — 4개 화면(회원가입/로그인/Admin/챗봇) 와이어프레임 (데스크톱+모바일)
- `docs/8-erd.md` — DB ERD (Mermaid), 테이블별 설명
- `docs/9-plan.md` — 실행계획. DB/백엔드/프론트 Task 분해, 선행관계, 체크박스형 완료조건. **작업 진행 시 이 문서를 기준으로 순서를 따르고, Task 완료 시 체크박스를 갱신할 것**
- `docs/swagger.json` — 백엔드 API 계약(OpenAPI 3.0). 구현과 맞춰 유지할 것
- `docs/laptop-server-setup.md` — **운영 배포 절차서(정본)**. 이 시스템이 사내망 전용이라 클라우드 배포가 불가능해, 사내 전용 노트북 1대에서 프론트+백엔드+스케줄러를 돌리고 DB만 Supabase를 쓴다. 배포/재시작/업데이트 시 이 문서를 따를 것
- `docs/design/chatbot-shell.html` — 웹 챗봇 UI **최초 설계 목업**(Intercom 디자인 시스템 기반). 이후 구현이 앞서 나갔으므로 **현재 화면의 정본은 코드**이고, 이 파일은 원래 디자인 의도를 볼 때만 참고한다
- `docs/design/mobile-composer-proposal.html` — 모바일 컴포저 축소안 비교 목업(20260816)
- `docs/diagrams/architecture-overview.html` — 아키텍처 SVG 다이어그램
- `DESIGN.md` — 디자인 시스템 토큰(Intercom 기반: 색상/타이포/spacing/컴포넌트)
- `supabase/8-schema.sql` — DB 최종 통합 스키마(참고용 스냅샷, source of truth는 `supabase/migrations/`)
- `supabase/migrations/` — 실제 마이그레이션 이력(정본). 새 변경은 여기 새 파일로 추가하고 `8-schema.sql`에도 반영
- `.env.example` — 필요한 환경변수 목록과 용도 설명
- `.claude/agents/*.md`, `.agents/agents/*/agent.json` — 프로젝트 서브에이전트 정의. 서로 동기화 유지
