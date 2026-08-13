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
```

## 테이블별 설명

- **admin_whitelist**: 가입 즉시 자동으로 Admin 권한을 받는 사내 계정 ID 사전 등록 목록(Admin 부트스트랩용).
- **users**: 온보딩 승인을 마친 사용자. 사내 계정 비밀번호(복호화 가능한 암호화)와 앱 자체 로그인 비밀번호(단방향 해시)를 분리해서 저장한다.
- **account_registration_requests**: 회원가입 웹페이지에서 제출한 계정 등록 신청 건. 화이트리스트 매칭 시 자동승인, 아니면 Admin 수동 승인/거부 대상.
- **rooms**: 예약 가능한 회의실 목록(상암S시티, 3F/12~16F). CJ 사내 시스템의 area_code/sub_area_code/room_code를 그대로 보관해 예약 API 호출에 사용한다.
- **user_preferred_rooms**: 사용자가 가입 시 등록한 선호 회의실 우선순위 목록(User와 Room의 다대다 관계를 정규화한 테이블).
- **reservation_requests**: 챗봇에 입력된 예약 요청 원본 조건(희망 날짜/시간 등)과 처리 상태.
- **reservations**: 확정된 예약 건. CJ 사내 예약 시스템의 seq(`cj_seq`)를 저장해 변경/취소 API 호출 근거로 사용하며, 동일 회의실·겹치는 시간대 중복 예약은 DB EXCLUDE 제약으로 방지한다.
- **alternative_suggestions**: 요청 시간대가 충돌할 때 제시하는 대체 회의실/시간대 추천 목록.
