# CJFW-VBCD 프로젝트의 최상위 지침

## 반드시 준수할 최우선 지침

- 모든 대화는 한국어로 할 것
- 오버엔지니어링 금지
- 응답은 사용자가 쉽게 이해할 수 있게 할 것

## 개발할 때 다음 사항을 준수할 것

- 안드레 카파시의 CLAUDE.md
- https://raw.githubusercontent.com/multica-ai/andrej-karpathy-skills/refs/heads/main/CLAUDE.md

## 프로젝트 문서 참조 (source of truth)

작업 전 관련 문서를 먼저 확인할 것. 규칙/구조가 바뀌면 문서를 먼저 고치고 코드를 따라 고친다.

- `prompts/1-domain-definition-meeting-room-agent.md` — 도메인 정의서(최상위 source of truth). 온보딩 플로우, 유스케이스, 비즈니스 규칙, §9 CJ 시스템 API 명세
- `prompts/4-prd.md` — PRD. 인프라 구성(Vercel+Supabase), 인증/보안(JWT access+refresh) 결정사항, 진행 상태
- `prompts/5-project-principle.md` — 코드 구현 시 반드시 따라야 할 구조 원칙(레이어 의존 방향, 네이밍, 폴더 구조, 보안/설정 원칙)
- `prompts/6-arch-diagram.md` — 시스템 아키텍처 Mermaid 다이어그램
- `prompts/7-wireframes.md` — 4개 화면(회원가입/로그인/Admin/챗봇) 와이어프레임 (데스크톱+모바일)
- `prompts/8-erd.md` — DB ERD (Mermaid), 테이블별 설명
- `prompts/9-plan.md` — 실행계획. DB/백엔드/프론트 Task 분해, 선행관계, 체크박스형 완료조건. **작업 진행 시 이 문서를 기준으로 순서를 따르고, Task 완료 시 체크박스를 갱신할 것**
- `docs/service-scenarios.md` — 사용자 시나리오 12개
- `docs/swagger.json` — 백엔드 API 계약(OpenAPI 3.0). 구현과 맞춰 유지할 것
- `docs/design/chatbot-shell.html` — 웹 챗봇 UI **최초 설계 목업**(Intercom 디자인 시스템 기반). 이후 구현이 앞서 나갔으므로 **현재 화면의 정본은 코드**이고, 이 파일은 원래 디자인 의도를 볼 때만 참고한다
- `docs/design/mobile-composer-proposal.html` — 모바일 컴포저 축소안 비교 목업(20260816)
- `docs/diagrams/architecture-overview.html` — 아키텍처 SVG 다이어그램
- `DESIGN.md` — 디자인 시스템 토큰(Intercom 기반: 색상/타이포/spacing/컴포넌트)
- `supabase/8-schema.sql` — DB 최종 통합 스키마(참고용 스냅샷, source of truth는 `supabase/migrations/`)
- `supabase/migrations/` — 실제 마이그레이션 이력(정본). 새 변경은 여기 새 파일로 추가하고 `8-schema.sql`에도 반영
- `.env.example` — 필요한 환경변수 목록과 용도 설명
- `.claude/agents/*.md`, `.agents/agents/*/agent.json` — 프로젝트 서브에이전트 정의. 서로 동기화 유지
