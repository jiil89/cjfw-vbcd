# 기술 아키텍처 다이어그램

CJ 사내 예약 시스템이 사내망 전용이라 사내망 밖에서 접근 불가하므로, 클라우드 배포(Vercel) 대신 **사내 전용 노트북 1대**가 프론트+백엔드를 한 프로세스로 같이 띄우고, DB만 Supabase(외부)를 쓴다. 외부(모바일 등)에서 접속할 때는 Cloudflare Tunnel로 그 노트북에 터널을 뚫는다. 상세 배경: `4-prd.md`, 배포 절차: `laptop-server-setup.md`.

```mermaid
flowchart TD
    User["사용자<br/>(임직원, 브라우저·모바일)"]
    Admin["관리자<br/>(승인 담당자)"]
    Tunnel["Cloudflare Tunnel<br/>(사내망 밖 접속용)"]

    subgraph Laptop["사내 전용 노트북 (같은 프로세스)"]
        Frontend["프론트엔드<br/>React 19 + Zustand + TanStack Query<br/>(정적 파일, Express가 서빙)"]
        Backend["백엔드<br/>Node.js + Express"]
        Scheduler["Windows 작업 스케줄러<br/>(반복예약 job, 매일 00:01)"]
    end

    DB[("Supabase DB<br/>(Postgres, Session/Transaction Pooler)")]
    LLM["OpenAI API<br/>(LLM)"]
    CJ["CJ 사내 예약 시스템<br/>(사내망 전용<br/>Playwright + @sparticuz/chromium)"]

    User -->|"사내망: 직접 / 사외망: 터널 경유"| Tunnel
    Tunnel --> Frontend
    User -.->|"사내망 내부에서는 직접 접속 가능"| Frontend
    Admin -->|"승인/거부, 잠긴 계정 해제"| Frontend
    Frontend -->|"API 요청 (같은 오리진)"| Backend
    Backend -->|"조회/저장"| DB
    Backend -->|"자연어 이해, 도구 호출"| LLM
    Backend -->|"로그인·예약 API 호출"| CJ
    Scheduler -->|"대상일 -7일 00:01 실행"| Backend
```

## 백엔드 레이어 구조

`5-project-principle.md` §2의 의존 방향을 그림으로 옮긴 것. **화살표 방향을 거스르는 import는 구조 원칙 위반**이다(예: `cj-automation`이 `orchestration`을 부르는 것).

```mermaid
flowchart TD
    Routes["routes/<br/>auth · me · admin · chat · rooms"]
    Orchestration["orchestration/<br/>systemPrompt · orchestrator · sessionStore"]
    Tools["tools/<br/>availability · reservation · modify · cancel · myReservations"]
    Repos["db/repositories/<br/>user · reservation · room · refreshToken"]
    CjAuto["cj-automation/<br/>session · client"]
    Security["security/<br/>appPassword(해시) · corporatePassword(암호화)"]
    Services["services/<br/>auth · registration · admin · password"]

    Routes --> Orchestration
    Routes --> Services
    Orchestration --> Tools
    Tools --> Repos
    Tools --> CjAuto
    Services --> Repos
    Services --> Security
    Services --> CjAuto
    Routes -.->|"의도된 예외:<br/>로그인 시 세션 예열"| CjAuto
```

- `orchestration`은 `tools/`만 부른다 — `pg`나 Playwright를 직접 알지 못한다.
- **`security/`의 두 모듈은 절대 섞이지 않는다**: `corporatePassword`(CJ WORLD PW, 복호화 가능) vs `appPassword`(앱 로그인, 단방향 해시).
- 점선은 `5-project-principle.md` §2에 명시된 **의도된 예외** 두 가지(로그인 시 CJ 세션 예열, 비밀번호 재등록 시 CJ 검증)다.

## 프론트엔드 컴포넌트 구조

```mermaid
flowchart TD
    subgraph FE["프론트엔드 (React 19)"]
        Pages["Pages<br/>회원가입 / 로그인 / Admin 패널 / 챗봇 UI"]
        Components["공용 Components"]
        Stores["Zustand Stores<br/>(accessToken, UI 상태)"]
        Queries["TanStack Query<br/>(서버 상태/통신)"]
        Http["httpClient<br/>(fetch 래퍼)"]
    end
    BackendAPI["백엔드 API<br/>(같은 노트북, 같은 오리진)"]

    Pages --> Components
    Pages --> Stores
    Pages --> Queries
    Queries --> Http
    Http -->|"accessToken 첨부"| BackendAPI
```
