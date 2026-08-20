# ERD (Entity Relationship Diagram)

Supabase(Postgres) 마이그레이션(`supabase/migrations/`) 기준 최종 스키마를 반영한 ERD.

```mermaid
erDiagram
    ADMIN_WHITELIST ||--o{ USERS : "added_by_user_id"
    USERS ||--o{ ACCOUNT_REGISTRATION_REQUESTS : "processed_by_user_id"
    USERS ||--o{ ACCOUNT_REGISTRATION_REQUESTS : "resulting_user_id"
    USERS ||--o{ USER_PREFERRED_ROOMS : "user_id"
    ROOMS ||--o{ USER_PREFERRED_ROOMS : "room_id"
    USERS ||--o{ RESERVATION_REQUESTS : "user_id"
    USERS ||--o{ RESERVATIONS : "user_id"
    ROOMS ||--o{ RESERVATIONS : "room_id"
    RESERVATION_REQUESTS ||--o{ RESERVATIONS : "reservation_request_id"
    RESERVATIONS |o--o| RESERVATION_REQUESTS : "reservation_id (편의 컬럼)"
    RESERVATION_REQUESTS ||--o{ ALTERNATIVE_SUGGESTIONS : "reservation_request_id"
    ROOMS ||--o{ ALTERNATIVE_SUGGESTIONS : "room_id"
    USERS ||--o{ REFRESH_TOKENS : "user_id"
    USERS ||--o{ RECURRING_RESERVATION_RULES : "user_id"
    RECURRING_RESERVATION_RULES ||--o{ RECURRING_RESERVATION_RULE_ROOMS : "rule_id"
    ROOMS ||--o{ RECURRING_RESERVATION_RULE_ROOMS : "room_id"
    RECURRING_RESERVATION_RULES ||--o{ RECURRING_RESERVATION_RUNS : "rule_id"
    RECURRING_RESERVATION_RUNS |o--o| RESERVATIONS : "reservation_id"
    RECURRING_RESERVATION_RUNS |o--o| ROOMS : "booked_room_id"

    ADMIN_WHITELIST {
        uuid id PK
        text email_alias UK
        text reason
        uuid added_by_user_id FK
        timestamptz created_at
    }

    USERS {
        uuid id PK
        bigint telegram_user_id UK "nullable, 향후 텔레그램 채널용"
        text email_alias UK
        text encrypted_password "AES 암호화(복호화 가능)"
        text app_password_hash "bcrypt/argon2 단방향 해시, NOT NULL"
        boolean is_admin
        text status "active | revoked"
        timestamptz approved_at
        timestamptz revoked_at
        timestamptz created_at
        timestamptz updated_at
    }

    ACCOUNT_REGISTRATION_REQUESTS {
        uuid id PK
        text email_alias
        text encrypted_password "AES 암호화(복호화 가능)"
        text app_password_hash "bcrypt/argon2 단방향 해시"
        text telegram_deeplink_token UK "nullable"
        bigint telegram_user_id "nullable"
        text status "pending|auto_approved|approved|rejected"
        uuid processed_by_user_id FK
        boolean processed_by_system
        timestamptz processed_at
        uuid resulting_user_id FK
        timestamptz created_at
    }

    ROOMS {
        uuid id PK
        text site "상암S시티 고정"
        text area_code "건물 코드"
        text sub_area_code "층 코드"
        text room_code UK "CJ 시스템 예약 API 식별자"
        text room_name
        text floor_label
        int capacity
        boolean is_bookable
        timestamptz created_at
        timestamptz updated_at
    }

    USER_PREFERRED_ROOMS {
        uuid id PK
        uuid user_id FK
        uuid room_id FK
        int priority "1이 최우선, (user_id, priority) UK"
        timestamptz created_at
    }

    RESERVATION_REQUESTS {
        uuid id PK
        uuid user_id FK
        text title
        text contents
        date desired_date
        time desired_start_time
        time desired_end_time
        text status "received|availability_checked|confirmed|conflict|cancelled"
        uuid reservation_id FK "분할 없이 1건으로 끝난 경우만"
        timestamptz created_at
    }

    RESERVATIONS {
        uuid id PK
        uuid reservation_request_id FK
        uuid user_id FK
        uuid room_id FK
        text cj_seq UK "CJ 사내 시스템 예약 고유번호"
        text title
        text contents
        timestamptz start_at
        timestamptz end_at
        text status "confirmed|modified|cancelled"
        timestamptz created_at
        timestamptz updated_at
    }

    ALTERNATIVE_SUGGESTIONS {
        uuid id PK
        uuid reservation_request_id FK
        uuid room_id FK
        timestamptz suggested_start_at
        timestamptz suggested_end_at
        int rank "1이 가장 추천"
        boolean is_selected
        timestamptz created_at
    }

    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash UK "토큰 원문 대신 해시값만 저장"
        timestamptz issued_at
        timestamptz expires_at
        boolean revoked
        timestamptz revoked_at
        timestamptz created_at
    }

    RECURRING_RESERVATION_RULES {
        uuid id PK
        uuid user_id FK
        smallint weekday "0=일요일, JS Date.getDay() 규약"
        time start_time
        time end_time
        text title
        text contents
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    RECURRING_RESERVATION_RULE_ROOMS {
        uuid id PK
        uuid rule_id FK
        uuid room_id FK
        int priority "1이 최우선, (rule_id, priority) UK"
        timestamptz created_at
    }

    RECURRING_RESERVATION_RUNS {
        uuid id PK
        uuid rule_id FK
        date target_date
        text status "succeeded|failed|skipped"
        uuid reservation_id FK "성공 시에만 null 아님"
        uuid booked_room_id FK "성공 시에만 null 아님"
        int attempted_priority
        text failure_reason
        timestamptz executed_at
    }
```

## 테이블별 설명

- **admin_whitelist**: 가입 즉시 자동으로 Admin 권한을 받는 CJ WORLD ID 사전 등록 목록(Admin 부트스트랩용).
- **users**: 온보딩 승인을 마친 사용자. CJ WORLD PW(복호화 가능한 암호화)와 앱 자체 로그인 비밀번호(단방향 해시)를 분리해서 저장한다. 두 값 모두 사용자가 나중에 변경할 수 있다(도메인 정의서 2번 "비밀번호 변경" 참고) — 컬럼을 덮어쓰는 방식이라 스키마 변경은 없다.
- **account_registration_requests**: 회원가입 웹페이지에서 제출한 계정 등록 신청 건. 화이트리스트 매칭 시 자동승인, 아니면 Admin 수동 승인/거부 대상.
- **rooms**: 예약 가능한 회의실 목록(상암S시티, 3F/12~16F). CJ 사내 시스템의 area_code/sub_area_code/room_code를 그대로 보관해 예약 API 호출에 사용한다.
- **user_preferred_rooms**: 사용자가 가입 시 등록한 선호 회의실 우선순위 목록(User와 Room의 다대다 관계를 정규화한 테이블).
- **reservation_requests**: 챗봇에 입력된 예약 요청 원본 조건(희망 날짜/시간 등)과 처리 상태.
- **reservations**: 확정된 예약 건. CJ 사내 예약 시스템의 seq(`cj_seq`)를 저장해 변경/취소 API 호출 근거로 사용하며, 동일 회의실·겹치는 시간대 중복 예약은 DB EXCLUDE 제약으로 방지한다.
- **alternative_suggestions**: 요청 시간대가 충돌할 때 제시하는 대체 회의실/시간대 추천 목록.
- **refresh_tokens**: JWT 로그인의 Refresh Token 발급 이력. 토큰 원문이 아니라 해시값만 저장하며, 개별 로그아웃(해당 행 하나 폐기) 또는 비밀번호 변경/보안사고 대응 시 전체 폐기(해당 user_id의 미폐기 행 전체 UPDATE) 두 시나리오 모두 지원한다.
- **chat_sessions** `[20260816 추가]`: 사용자별 챗봇 오케스트레이션 세션(대화 이력 + 확인대기 상태)을 `state jsonb` 하나로 통째로 저장한다. 원래는 `sessionStore.ts`의 in-memory `Map`으로만 관리했는데, Vercel 서버리스에서는 함수 인스턴스가 바뀌면 그 메모리가 통째로 사라져 대화 기억이 유실되는 문제가 있어 DB로 옮겼다. `user_id`가 PK라 사용자당 세션 1개(도메인 정의서 1번: 챗봇 대화 채널이 하나라는 전제)라는 기존 설계를 그대로 반영한다.
- **recurring_reservation_rules** `[신규]`: 사용자가 등록한 반복 예약 규칙. 매주 어느 요일 어느 시간대에 어떤 회의명으로 예약할지 정의한다. `is_active`는 동의 철회 시 자동으로 false로 설정되어 규칙을 비활성화한다.
- **recurring_reservation_rule_rooms** `[신규]`: 각 반복 예약 규칙이 시도할 회의실 목록(1~3순위). **이는 `user_preferred_rooms`(가입 시 등록하는 선호 회의실)과 다른 목적**이다 — 같은 사용자도 규칙마다 다른 회의실 우선순위를 가질 수 있다. `(rule_id, priority)` unique 제약으로 같은 규칙에서 중복된 우선순위를 방지하고, `(rule_id, room_id)` unique 제약으로 같은 회의실이 중복되지 않게 한다.
- **recurring_reservation_runs** `[신규]`: 반복 예약 규칙의 자동 실행 로그 + 멱등성 보장. 매 실행 시마다 대상일, 상태(성공/실패/스킵), 최종 성공한 회의실(있으면), 시도 우선순위 단계, 실패 사유를 기록한다. `(rule_id, target_date)` unique 제약으로 **같은 규칙의 같은 날짜 중복 실행을 방지** — PC 재부팅이나 수동 재실행으로 잡이 같은 날 두 번 돌아도, 잡이 실행 전에 이 행의 존재를 먼저 확인하고 건너뛰므로 **첫 실행 결과가 그대로 남고 CJ에 중복 예약이 생기지 않는다**(나중 실행이 앞의 결과를 덮어쓰지 않는다).
