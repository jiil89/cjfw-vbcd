# Handoff: 회의실 예약 — 채팅 화면 + 메시지 카드 UI + 인증 화면

## Overview
사내 회의실 예약 서비스의 **① 챗봇 어시스턴트 메시지 카드/칩 UI**와 **② 로그인 · 계정 등록 신청 화면**, **③ 채팅 화면 셸(PC · 모바일)**을 다시 디자인한 결과물입니다.
세 영역은 같은 색·타이포·라운드·버튼 규칙(아래 Design Tokens)을 공유합니다.
기존 UI는 회의실 후보를 같은 크기의 박스 8개로 3열 그리드에 늘어놓아 세로 공간을 크게 차지했고,
"어디를 골라야 하는지"가 시각적으로 드러나지 않았습니다.

새 디자인의 원칙은 세 가지입니다.

1. **큰 카드는 "지금 결정할 대상" 하나뿐** — 추천/선택된 회의실 1곳만 카드로 크게 보여줍니다.
2. **나머지 후보는 칩(chip)** — 한 줄 높이의 작은 pill로 접어 세로 공간을 절약합니다. 칩을 누르면 그 회의실이 큰 카드로 승격됩니다.
3. **메시지당 주 행동(primary action)은 하나** — 카드 하단의 검은 버튼 1개. 되돌리기 어려운 행동(취소)에만 빨간 계열을 씁니다.

## About the Design Files
이 번들의 파일은 **HTML로 만든 디자인 레퍼런스**입니다. 의도한 모양과 동작을 보여주는 프로토타입이며,
그대로 복사해 쓰는 프로덕션 코드가 아닙니다.

해야 할 일은 이 HTML 디자인을 **대상 코드베이스의 기존 환경(React / Vue / Svelte / 네이티브 등)에서
그 프로젝트의 기존 패턴과 컴포넌트 라이브러리로 재현**하는 것입니다.
아직 환경이 없다면 프로젝트에 가장 적합한 프레임워크를 골라 구현하세요.

`.dc.html` 파일은 커스텀 런타임(`<x-dc>`, `<sc-for>`, `{{ }}` 바인딩)을 쓰는 스트리밍 프로토타입 포맷입니다.
런타임을 이식하지 마세요. `<sc-for list="{{ items }}" as="r">`는 `items.map(...)`으로 읽으면 됩니다.
스타일은 전부 인라인이며, 값은 아래 Design Tokens에 정리해 두었습니다.
브라우저에서 파일을 직접 열면 전체 디자인을 볼 수 있습니다.

## Fidelity
**High-fidelity (hifi)** — 색상, 타이포그래피, 간격, 라운드, 상호작용까지 최종값입니다.
코드베이스의 기존 컴포넌트를 쓰되 시각 결과는 이 문서의 수치를 그대로 재현하세요.
단, 대상 코드베이스에 이미 디자인 시스템이 있다면 아래 hex 값 대신 **가장 가까운 기존 토큰**으로 치환하는 편이 낫습니다
(중립 그레이 스케일 + 성공 그린 + 추천 앰버 + 위험 레드 + 브랜드 오렌지 구성).

## Screens / Views

모든 화면은 채팅 스레드 안의 **메시지 버블 + 첨부 카드** 조합입니다.
공통 컨테이너: 채팅 컬럼 폭 **460px**(데스크톱 기준), 카드는 컬럼 폭 100%.

### 공통: 메시지 버블

- **사용자 버블**: 우측 정렬. `background #111111`, `color #FFFFFF`, `font-size 14px`, `line-height 1.5`,
  `padding 10px 14px`, `border-radius 16px 16px 4px 16px`, `max-width 75%`.
- **어시스턴트 아바타**: 26×26px 원, `background #E8552A`, 흰색 "A", `font-size 12px`, `font-weight 700`,
  `flex: none`, `margin-top 2px`. 아바타와 메시지 컬럼 사이 `gap 10px`.
- **어시스턴트 버블**: 좌측 정렬(`align-self: flex-start`). `background #F1F0EE`, `color #1C1C1B`, `font-size 14px`,
  `line-height 1.5`, `padding 10px 14px`, `border-radius 16px 16px 16px 4px`.
- 어시스턴트 메시지 컬럼(버블 + 카드)은 `display:flex; flex-direction:column; gap:10px`.

### 공통: 첨부 카드 셸

`border: 1px solid #DFDEDA`, `border-radius: 14px`, `background: #FFFFFF`.
내부 패딩은 유형에 따라 다릅니다 — 자유 배치형 `14px`, 행 리스트형은 패딩 0 + 각 행 `11px 14px` + `overflow: hidden`.
하단 액션 바가 있는 경우 `background #FBFBFA`, `border-top 1px solid #F0EFED`, `padding 11px 14px`.

### 공통: 회의실 칩 (chip)

- 기본: `display:inline-flex; align-items:center; gap:5px; padding:6px 10px; border-radius:9px;`
  `border:1px solid #E4E3DF; background:#FFFFFF; color:#1C1C1B; font-size:13px; font-weight:500; white-space:nowrap; cursor:pointer`
- 선택됨: `border:1px solid #111111; background:#111111; color:#FFFFFF`
- 칩 안 보조 텍스트(정원 등): `font-size:11.5px; font-variant-numeric:tabular-nums;`
  색 `#9A9A95` (선택 시 `rgba(255,255,255,0.62)`)
- hover: `border-color: #B9B8B3` / transition: `border-color .12s, background .12s`
- 칩 그룹: `display:flex; flex-wrap:wrap; gap:6px`

---

### 1. 추천 우선형 — 기본 예약 흐름 (파일 하단 섹션)

- **Purpose**: "다음주 월요일, 오전 10시, 1시간동안, 7명" 같은 요청에 대해 1곳을 추천하고 즉시 확정하게 함.
- **Layout**: 사용자 버블 → 어시스턴트 버블("7명 · 10:00–11:00, 가능한 회의실 8곳이에요.") → 추천 카드 → "다른 후보 7곳" 칩 그룹.
- **추천 카드** (카드 셸, `padding 14px`, `display:flex; flex-direction:column; gap:12px`):
  - 헤더 행: `display:flex; align-items:baseline; justify-content:space-between; gap:8px`
    - 좌측: 회의실명 `font-size:18px; font-weight:700; color:#1C1C1B; letter-spacing:-0.01em`
      + "추천" 배지 `font-size:11px; font-weight:600; color:#7A5C00; background:#FCF1CF; padding:2px 7px; border-radius:5px` (`gap 8px`)
    - 우측: 세로 스택, 우측 정렬, `gap 1px`
      - 날짜 `font-size:11.5px; color:#9A9A95; tabular-nums` — 예: "8월 17일 (월)"
      - 시간 `font-size:12.5px; color:#8B8B87; tabular-nums` — 예: "10:00–11:00"
  - 태그 행 (`display:flex; gap:6px; flex-wrap:wrap`):
    - 정원 태그 `font-size:12px; font-weight:600; color:#1E7A4B; background:#E8F5EC; padding:3px 8px; border-radius:6px` — "12인"
    - 부가 태그 `font-size:12px; color:#6E6E6A; background:#F2F1EF; padding:3px 8px; border-radius:6px` — "선호 회의실" / "여유 좌석"
  - 주 버튼: 전체 폭, 가운데 정렬, `background:#111111; color:#FFFFFF; font-size:13.5px; font-weight:600; padding:10px 12px; border-radius:9px`, hover `background:#000000` — "이 회의실로 확정"
- **칩 그룹 라벨**: `font-size:12px; font-weight:600; color:#8B8B87` — "다른 후보 7곳"(개수 동적)
- **동작**: 칩 클릭 → 그 회의실이 카드로 승격, 기존 회의실은 칩 목록으로 복귀. 목록은 항상 "선택된 1곳 제외 전체", 원본 순서 유지.

### 2. 내 예약 조회 (`2a`)

- **Purpose**: "내가 오늘 예약한 회의실은 뭐야?"에 대한 응답.
- **Layout**: 어시스턴트 버블("오늘 예약 3건이에요. 다음 일정은 1시간 뒤예요.") → 리스트 카드.
- **리스트 카드**:
  - 헤더 바: `padding:9px 14px; background:#FBFBFA; border-bottom:1px solid #F0EFED`.
    좌측 날짜 `font-size:12px; font-weight:600; color:#6E6E6A` / 우측 건수 `font-size:12px; color:#9A9A95; tabular-nums`
  - 예약 행 (`display:flex; align-items:center; gap:10px; padding:11px 14px`, 첫 행 제외 `border-top:1px solid #F0EFED`):
    - 좌측 레일: `width:3px; height:28px; border-radius:2px` — 다음 일정 `#E8552A`, 그 외 `#E0DFDB`
    - 중앙 스택(`gap 2px; flex:1`): 회의실명 `font-size:14px; font-weight:600; color:#1C1C1B; letter-spacing:-0.01em` + 상태 배지 / 아랫줄 회의 제목 `font-size:12.5px; color:#8B8B87`
    - 우측 시간 `font-size:13px; color:#3C3C3A; tabular-nums; white-space:nowrap`
    - 상태 배지: "다음" = `color:#B23F1D; background:#FBEBE4`, 그 외 = `color:#8B8B87; background:#F2F1EF`,
      공통 `font-size:11px; font-weight:600; padding:2px 6px; border-radius:5px`
    - 이미 종료된 행은 `opacity: 0.55`
  - 하단 액션 바: 보조 버튼 2개 "시간 변경", "예약 취소" —
    `font-size:12.5px; font-weight:600; color:#1C1C1B; border:1px solid #E4E3DF; background:#FFFFFF; padding:7px 12px; border-radius:8px`, hover `border-color:#B9B8B3`

### 3. 전체 가용 목록 (`2b`)

- **Purpose**: "오늘 오후 2-3시에 가능한 회의실 리스트 다 알려줘" — 후보가 10곳 이상일 때.
- **Layout**: 어시스턴트 버블("14:00–15:00에 14곳 비어 있어요. 층별로 정리했어요.") → 층별 그룹 카드.
- **층별 그룹 카드** (`padding: 6px 14px 12px`):
  - 층 행: `display:flex; gap:12px; align-items:center; padding:9px 0; border-bottom:1px solid #F0EFED`
    - 층 라벨 `width:34px; flex:none; font-size:12.5px; font-weight:700; color:#8B8B87; tabular-nums` — "3F", "8F", …
    - 칩 그룹: 공통 칩 규칙, `flex:1; min-width:0`
  - 하단 행 (`padding-top:12px; justify-content:space-between`):
    - 좌측 "선택 · **3F-6**" — 라벨 `font-size:12.5px; color:#8B8B87`, 값 `color:#1C1C1B; font-weight:600`
    - 우측 주 버튼 `background:#111111; color:#FFFFFF; font-size:13px; font-weight:600; padding:9px 16px; border-radius:9px` — "이 회의실로 예약"
- **동작**: 칩 단일 선택 → 하단 요약과 버튼 대상 갱신.
- 층 정렬은 사용자가 자주 쓰는 층 → 낮은 층 순. 층이 6개를 넘으면 상위 4개 층만 펼치고 나머지는 "더 보기"로 접기를 권장.

### 4. 취소 대상 되묻기 (`2c`)

- **Purpose**: "오늘 예약한 회의실 취소할게" → 예약이 여러 건이라 대상 확인이 필요할 때.
- **Layout**: 어시스턴트 버블("오늘 예약 3건 중 어떤 걸 취소할까요?") → 라디오 리스트 카드.
- **행** (`display:flex; align-items:center; gap:10px; padding:11px 14px; cursor:pointer`, 첫 행 제외 `border-top:1px solid #F0EFED`):
  - 라디오 `16×16px` 원, `border:1px solid #D6D5D1`(선택 시 `#C0362C`), 내부 점 `8×8px` — 선택 시 `#C0362C`, 아니면 투명
  - 회의실명 `font-size:14px; font-weight:600`(선택 시 `700`), `color:#1C1C1B` / 회의 제목 `font-size:12.5px; color:#8B8B87`
  - 우측 시간 `font-size:13px; color:#3C3C3A; tabular-nums`
  - 선택 행 배경 `#FCF5F4`, hover 배경 `#FAFAF9`, `transition: background .12s`
- **하단 액션 바**: 좌측 힌트 `font-size:12.5px; color:#8B8B87` — 미선택 "취소할 예약을 골라주세요", 선택 시 "3F-6 예약을 취소해요".
  우측 위험 버튼 `background:#FFFFFF; color:#C0362C; border:1px solid #EBC9C4; font-size:13px; font-weight:600; padding:8px 14px; border-radius:9px`, hover `background:#FCF1EF` — "취소하기"
- 대상이 선택되기 전에는 위험 버튼 비활성(`opacity .5`, 클릭 불가) 처리를 권장합니다.

### 5. 취소 완료 · 되돌리기 (`2d`)

- **Purpose**: 취소 실행 결과 확인 + 실수 복구 경로.
- **Layout**: 어시스턴트 버블("취소했어요. 참석자에게 알림도 보냈어요.") → 결과 카드.
- **결과 카드** (`padding:14px; display:flex; align-items:center; gap:12px`):
  - 좌측 스택(`gap 3px; flex:1`):
    - `font-size:15px; font-weight:600; color:#8B8B87; text-decoration:line-through; letter-spacing:-0.01em` — "13F-3 · 13:00–14:00"
    - `font-size:12.5px; color:#9A9A95` — "디자인 리뷰 · 8월 14일 (금)"
  - 우측 보조 버튼 "되돌리기" `font-size:12.5px; font-weight:600; color:#1C1C1B; border:1px solid #E4E3DF; background:#FFFFFF; padding:8px 12px; border-radius:8px; white-space:nowrap`, hover `border-color:#B9B8B3`
- 되돌리기는 일정 시간(예: 5분) 또는 회의 시작 전까지만 노출을 권장합니다.

### 6. 가능한 곳 없음 · 대안 제시 (`2e`)


- **Purpose**: 조건에 맞는 회의실이 0곳일 때 막다른 길을 만들지 않음.
- **Layout**: 어시스턴트 버블("16:00에 20인실은 비어 있는 곳이 없어요. 가까운 대안이에요.") → 대안 카드.
- **대안 카드** (`padding:14px; display:flex; flex-direction:column; gap:12px`), 두 그룹을 `1px` 구분선(`background:#F0EFED`)으로 분리:
  - 그룹 1 "같은 회의실, 다른 시간" → 칩: 시간이 주 텍스트, 회의실명이 보조 (예: "15:00 / 20F-1")
  - 그룹 2 "16:00 가능, 조금 작은 곳" → 칩: 회의실명이 주 텍스트, 정원이 보조 (예: "18F-2 / 16인")
  - 그룹 라벨 `font-size:12px; font-weight:600; color:#8B8B87`, 라벨–칩 사이 `gap 7px`
  - 칩은 공통 규칙과 동일, 보조 텍스트 `font-size:11.5px; color:#9A9A95`

### 7. 로그인 (`3a`, 파일 `auth-login-signup.dc.html`)

- **Purpose**: 사내 계정 ID + 앱 로그인 비밀번호로 로그인.
- **Layout**: 페이지 배경 `#F4F3F1` 위에 가운데 정렬 컬럼(`max-width: 360px`). 위에서부터 브랜드 블록 → 폼 카드 → 하단 링크, 세로 `gap 22px`.
  (프로토타입에서는 데스크톱 뷰포트를 흉내내려고 `#F4F3F1` 패널 안에 넣었습니다. 실제 구현에서는 페이지 전체 배경이 `#F4F3F1`, 컬럼은 뷰포트 가운데 정렬 — 상하 여백 최소 44px.)
- **브랜드 블록** (가운데 정렬, `gap 12px`):
  - 로고 타일 `36×36px`, `border-radius:11px`, `background:#111111`, 흰색 글자 `font-size:15px; font-weight:700`
  - 제목 "회의실 예약" `font-size:21px; font-weight:700; color:#1C1C1B; letter-spacing:-0.02em`
  - 서브 "사내 계정으로 로그인하세요" `font-size:13.5px; color:#8B8B87`
- **폼 카드**: `background:#FFFFFF; border:1px solid #E4E3DF; border-radius:16px; padding:22px 20px;`
  `display:flex; flex-direction:column; gap:16px`
- **입력 필드** (전 화면 공통):
  - 라벨 `font-size:12.5px; font-weight:600; color:#6E6E6A`, 라벨–인풋 `gap 7px`
  - 인풋 `height:44px; padding:0 13px; font-size:14px; color:#1C1C1B; background:#FFFFFF;`
    `border:1px solid #E4E3DF; border-radius:10px; outline:none; box-sizing:border-box; width:100%`
  - hover `border-color:#B9B8B3`, **focus `border-color:#111111`** (파란 기본 outline 제거, 링 대신 보더 색만 변경), `transition: border-color .12s`
  - placeholder 색 `#B8B7B2`
  - 헬퍼 텍스트 `font-size:12px; color:#9A9A95`
- **비밀번호 표시 토글**: 라벨 행 우측의 텍스트 버튼 "표시"/"숨기기" `font-size:12px; font-weight:600; color:#8B8B87`, hover `#1C1C1B`. `input[type]`을 `password`↔`text`로 전환.
- **로그인 상태 유지 체크박스**: `16×16px`, `border-radius:5px`, 미체크 `border:1px solid #D6D5D1; background:#FFFFFF`, 체크 `border:1px solid #111111; background:#111111` + 내부 `6×6px` 흰 사각(`border-radius:2px`). 라벨 `font-size:13px; color:#3C3C3A`, 클릭 영역은 체크박스+라벨 전체.
- **비밀번호 찾기 링크**: 같은 행 우측, `font-size:13px; color:#8B8B87`, 밑줄 없음, hover `#1C1C1B`.
- **주 버튼**: 전체 폭, `height:46px; background:#111111; color:#FFFFFF; font-size:14.5px; font-weight:600; border-radius:11px`, hover `background:#000000`.
- **하단 링크**: 가운데 정렬 `font-size:13px; color:#8B8B87` + 강조 링크 `color:#1C1C1B; font-weight:600; border-bottom:1px solid #D6D5D1`, hover `color:#E8552A`.
- 원본 디자인의 연한 파란색 인풋 배경(`#E8EDFB` 계열)은 쓰지 않습니다. 흰 배경 + 보더로 통일하세요.

### 8. 계정 등록 신청 (`3b`, 파일 `auth-login-signup.dc.html`)

- **Purpose**: 승인제 계정 신청. 원본은 한 덩어리로 길게 이어진 폼이라 훑기 어려웠습니다.
- **Layout**: 로그인과 같은 가운데 정렬 구조, 컬럼 `max-width: 520px`. 브랜드 블록 서브 문구는 "승인까지 보통 1영업일이 걸려요".
- **폼 카드**: `padding: 6px 22px 22px`. 내부를 **번호가 붙은 3개 섹션**으로 나누고 섹션 사이 `border-bottom:1px solid #F0EFED`, 각 섹션 `padding: 22px 0`, 내부 `gap 15px`.
  - 섹션 헤더: `20×20px` 원형 번호(`background:#F2F1EF; color:#6E6E6A; font-size:11.5px; font-weight:700; tabular-nums`) + 제목 `font-size:14px; font-weight:700; color:#1C1C1B; letter-spacing:-0.01em` (+ 선택 섹션은 뒤에 `font-size:12px; color:#9A9A95` "선택"), `gap 9px`
  - **섹션 1 · 사내 계정**: 계정 ID(헬퍼 "메일 주소 앞부분이에요. @회사도메인은 빼고 입력하세요."), 계정 비밀번호(헬퍼 "예약 자동화 로그인에만 쓰이고 암호화 저장됩니다.")
  - **섹션 2 · 선호 회의실 (선택)**: 안내문 `font-size:12.5px; color:#8B8B87; line-height:1.5` — "자주 쓰는 순서대로 눌러주세요. 누른 순서가 추천 우선순위가 됩니다."
    그 아래 **공통 회의실 칩** 목록(위 "공통: 회의실 칩" 규칙과 동일).
    선택된 칩 앞에 순서 배지: `15×15px` 원, `background:#E8552A; color:#FFFFFF; font-size:10px; font-weight:700; tabular-nums` — 값은 선택 순서(1, 2, 3…).
    칩 아래 요약 바: `background:#FBFBFA; border:1px solid #F0EFED; border-radius:10px; padding:10px 12px`,
    좌측 `font-size:12.5px; color:#6E6E6A` — 선택 시 "우선순위 · 3F-6 → 14F-2", 미선택 시 "선택한 회의실이 없어요. 비워두면 매번 전체 목록에서 추천해요.";
    우측 "모두 지우기" `font-size:12px; font-weight:600; color:#9A9A95`(선택된 항목이 있을 때만 표시).
    → 원본의 `[+ 추가] / [- 삭제]` 버튼 쌍은 제거합니다.
  - **섹션 3 · 앱 로그인 비밀번호**: 안내문 "사내 계정 비밀번호와 다른 값을 쓰세요. 해시로 저장됩니다."
    비밀번호 / 비밀번호 확인을 **한 행에 2열**(`display:flex; gap:12px`, 각 `flex:1`)로 배치.
    확인 필드 보더는 상태에 따라 — 기본 `#E4E3DF`, 불일치 `#EBC9C4`, 일치 `#BFE0CB`.
    그 아래 상태 문구 `font-size:12px; font-weight:600` — 불일치 `color:#C0362C` "두 비밀번호가 서로 달라요", 일치 `color:#1E7A4B` "비밀번호가 일치해요", 입력 전에는 숨김.
- **주 버튼**: "등록 신청", 로그인과 동일 스펙 + `margin-top:8px`.
- **하단 링크**: "이미 승인된 계정이 있으신가요? **로그인**".
- 모바일에서는 섹션 3의 2열을 1열로 접고(`flex-direction: column`), 카드 좌우 패딩을 `16px`로 줄이세요.

### 9. 채팅 화면 — PC (`4a`, 파일 `chat-screen.dc.html`)

앞서의 메시지 카드들이 여기 어시스턴트 버블 자리에 들어갑니다. 이 화면은 그 셸입니다.

- **Purpose**: 일반 대화 화면. 기존 디자인은 모든 메시지에 아바타·시간이 반복되고 말풍선 폭이 사실상 무제한이어서 한 화면에 들어가는 대화량이 적었고, 우측 패널은 대부분 빈 공간이었습니다.
- **전체 구조** (3단): 최상단 헤더 `54px` → 본문 `flex: 1` (대화 컬럼 `flex:1` + 우측 패널 `268px`). 페이지 자체는 스크롤되지 않고 대화 영역과 패널이 각각 독립 스크롤합니다(`overflow-y:auto`, 부모에 `min-height:0`).
- **헤더** (`height:54px; padding:0 16px; border-bottom:1px solid #F0EFED`):
  - 좌측: 로고 타일 `26×26px; border-radius:8px; background:#111111` + 서비스명 `font-size:15px; font-weight:700; letter-spacing:-0.01em` + `3×3px` 원형 구분자(`#D6D5D1`) + 지사명 `font-size:13px; color:#8B8B87`.
  - 우측: 사용자 칩(22px 아바타 + 이름, hover `background:#F4F3F1`, 아바타 우하단에 `8×8px` 상태 점 `#3FA96B` + `1.5px` 흰 테두리) → `1×20px` 세로 구분자 `#EDECE9` → 고스트 텍스트 버튼 "Admin", "로그아웃" (`font-size:13px; font-weight:600; color:#6E6E6A; padding:6px 10px; border-radius:8px`, hover `background:#F4F3F1; color:#1C1C1B`).
    → 원본의 보더 있는 바운드 버튼 쌍을 고스트로 내렸습니다. 관리자가 아닌 사용자에게는 Admin 버튼 자체를 숨기세요.
- **대화 컬럼**: 스크롤 영역 안 `max-width:760px; margin:0 auto; padding:0 28px`, 그룹 사이 `gap:18px`, 상단 패딩 `20px`.
- **날짜 구분자**: 양쪽 선 `flex:1; height:1px; background:#F0EFED`, 텍스트 `font-size:12px; font-weight:600; color:#9A9A95`, `gap:12px` — "오늘 · 8월 14일 (금)".
- **메시지 그룹핑 (이 화면의 핵심)**: 같은 발화자의 연속 메시지를 한 그룹으로 묶습니다.
  - 아바타는 그룹당 **한 번만** (`26×26px`, `#E8552A`, 흰 "A", `margin-top:2px`, 아바타–버블 `gap:9px`)
  - 시간도 그룹당 **한 번만**, 마지막 버블 아래에 `font-size:11px; color:#B8B7B2; tabular-nums`
  - 그룹 내 버블 사이 `gap:3px`
  - **사용자 메시지에는 아바타를 달지 않습니다** (우측 정렬 + 검은 배경으로 이미 구분됨). 원본의 우측 "J" 아바타는 제거.
  - 버블 모서리로 그룹을 표현: 기본 `14px`, 그룹 중간 버블은 발화자쪽 변에 닿는 모서리만 `5px`, 그룹 마지막 버블은 꼬리 모서리 `4px`
- **버블**: `font-size:14px; line-height:1.55; padding:9px 13px`, 어시스턴트 `background:#F1F0EE; color:#1C1C1B` / 사용자 `background:#111111; color:#FFFFFF`.
  **`max-width: 68%`**, `text-wrap:pretty; word-break:keep-all`(한글 단어 중간 줄바꿈 방지).
- **컴포저** (하단 고정, `padding:10px 28px 18px`, 대화 컬럼과 같은 `max-width:760px`):
  - 퀵액션 칩 한 줄: 가로 스크롤(`overflow-x:auto`, 스크롤바 숨김), 칩 `font-size:12.5px; font-weight:600; color:#3C3C3A; border:1px solid #E4E3DF; padding:6px 11px; border-radius:8px`, `gap:6px`. 칩과 입력창 사이 `gap:9px` — 원본처럼 별도로 떠 있는 덩어리가 아니라 한 무리입니다.
  - 입력 행: `display:flex; gap:8px`. 입력창 `flex:1; height:46px; padding:0 14px; border:1px solid #E4E3DF; border-radius:12px; font-size:14px`,
    hover `border-color:#B9B8B3`, **focus `border-color:#111111` + `box-shadow:0 0 0 3px rgba(17,17,17,0.08)`**. 포커스 링은 반드시 입력 자체에 걸어 키보드 사용자가 현재 필드를 알 수 있게 하세요(랩퍼 상에 focus 표시가 없는 것이 원본의 버그입니다).
    전송 버튼은 입력창 **밖**의 형제 요소: `46×46px; border-radius:12px; background:#111111`, 흰 화살표 아이콘 `15–16px`, hover `#000000`.
  - 밑에 헬퍼 `font-size:11.5px; color:#B8B7B2` — "Enter 전송 · Shift+Enter 줄바꿈".
  - placeholder는 짧게: "내일 오전 10시 회의실 잡아줘" (원본은 "메시지를 입력하세요 (예: …)"로 너무 길어 모바일에서 잘렸습니다).
- **우측 패널** (`width:268px; border-left:1px solid #F0EFED; background:#FBFBFA; padding:18px 16px`, 섹션 사이 `gap:20px`):
  - 섹션 라벨 `font-size:11.5px; font-weight:700; letter-spacing:0.04em; color:#9A9A95`, 우측에 개수/"변경" 같은 보조 액션 `font-size:11.5px; color:#B8B7B2`.
  - **오늘 예약 빈 상태**: 한 줄 카드(`background:#FFFFFF; border:1px solid #EDECE9; border-radius:10px; padding:11px 12px`)에 "예약이 없어요" + 우측 텍스트 액션 "예약 잡기". 빈 상태가 세로 공간을 잡지 않고 다음 행동을 제안합니다. 예약이 있으면 2번(내 예약 조회)의 예약 행 스타일을 그대로 쓰세요.
  - **선호 회의실**: 행 카드(`padding:9px 11px`, 행 사이 `gap:5px`) — 우선순위 배지 `18×18px; border-radius:5px; font-size:11px; font-weight:700` (1순위 `background:#E8552A; color:#fff`, 그 이하 `background:#F2F1EF; color:#8B8B87`) + 회의실명 `font-size:13.5px; font-weight:600` + 우측 정원 `font-size:12px; color:#9A9A95; tabular-nums`. hover `border-color:#B9B8B3`.
  - **알아두기(정보 배너)**: `background:#FCF9EF; border:1px solid #F4EBD2; border-radius:10px; padding:11px 12px`, 좌측 `3px` 세로 레일 `#E8C35A`, 문구 `font-size:12.5px; line-height:1.55; color:#6E6E6A` — 강조만 `font-weight:700; color:#1C1C1B`.

### 10. 채팅 화면 — 모바일 (`4b`, 파일 `chat-screen.dc.html`)

기존 모바일 화면의 가장 큰 버그는 **우측 패널 내용이 입력창 아래로 세로로 나열되어** 대화 영역이 300px도 안 되게 짜부러진 것이었습니다. 사이드 패널을 아래로 흘리지 말고 시트로 분리하세요.

- **기준 뷰포트**: 390×780. 구조는 `height:100dvh` — 최상단 헤더 `52px` + `flex:1` 대화 스크롤 + 하단 컴포저 고정. 대화 영역은 항상 남는 공간 전부를 채웁니다.
- **헤더**: 좌측 로고 타일 + 2행 타이틀(서비스명 `14px/700`, 아래 지사명 `11px; color:#9A9A95`).
  우측: **"내 정보" 버튼**(햄버거 아이콘 13px + 라벨, `border:1px solid #E4E3DF; padding:6px 10px; border-radius:8px`) + `30×30px` 아바타. Admin·로그아웃은 헤더에서 **제거**하고 시트 하단으로 이동(자주 안 쓰는 기능이 헤더 폭을 잡아 제목이 잘렸습니다).
- **대화 영역**: `padding:16px 14px 8px`, 그룹 `gap:16px`. 버블 `font-size:13.5px`, `max-width:80%`. 그룹핑 규칙은 PC와 동일.
- **컴포저**: `border-top:1px solid #F0EFED`, `padding:8px 14px 16px`. 퀵액션 칩은 **가로 1행 스크롤**(에지까지 흘리도록 `margin:0 -14px; padding:0 14px`) — 줄바꿈하지 않습니다. 입력창·전송 버튼은 PC와 동일한 `46px` 하이트(터치 타겟 44px 이상 확보). iOS에서는 하단에 `env(safe-area-inset-bottom)` 패딩을 더하세요.
- **바텀시트 (우측 패널 대승)**:
  - 스크림: `position:absolute; inset:0; background:rgba(28,28,27,0.28)`, `opacity` 0↔1 + `pointer-events` 토글, `transition:opacity .18s`. 클릭 시 닫힘.
  - 시트: 하단 고정, `border-radius:18px 18px 0 0`, `border-top:1px solid #EDECE9`, `box-shadow:0 -8px 24px rgba(0,0,0,0.08)`,
    `transform: translateY(102%)` ↔ `translateY(0)`, `transition: transform .24s cubic-bezier(.32,.72,0,1)`.
  - 상단에 `34×4px` 핸들바(`#DFDEDA`, `border-radius:2px`). 내용 `padding:6px 16px 22px`, 섹션 `gap:18px`, `max-height:520px; overflow-y:auto`.
  - 내용 순서: 오늘 예약 → 선호 회의실 → 알아두기 배너 → 맨 아래 2열 보조 버튼("Admin 패널", "로그아웃", 각 `flex:1; padding:11px; border-radius:10px; border:1px solid #E4E3DF`).
  - 시트 안 카드 배경은 `#FBFBFA`(PC는 패널이 `#FBFBFA`, 카드가 `#FFFFFF`) — 반전된 관계입니다.
  - 추가 권장: 드래그 닫기, `Esc` 닫기, 시트 열림 상태에서 배경 스크롤 잠금.
- **이 화면의 범위**: 대화 버블과 컴포저만 담습니다. 예약·취소 같은 구조화된 응답은 어시스턴트 버블 **아래에** 1–6번 카드를 붙여 렌더링하세요(버블이 아닌 별도 요소, 그룹 스택 안, `gap:10px`). 모바일에서는 카드 폭을 대화 컬럼 전체 100%로 넣어 68/80% 제한을 받지 않게 하세요.

## Interactions & Behavior

- **칩 클릭(추천 우선형)**: 선택 교체. 큰 카드 내용 갱신, 이전 회의실은 칩 목록으로 복귀.
- **칩 클릭(전체 가용 목록)**: 단일 선택 토글. 선택 칩만 검은 배경, 하단 요약·버튼 대상 갱신.
- **행 클릭(취소 대상)**: 단일 선택. 배경·라디오·이름 굵기가 함께 변함.
- **hover**: 칩·보조 버튼 `border-color:#B9B8B3`, 리스트 행 `background:#FAFAF9`, 주 버튼 `background:#000000`.
- **transition**: `.12s`(색/배경/보더만). 카드 등장 모션은 채팅 앱의 기존 메시지 등장 모션을 따르세요.
- **로딩**: 조회 중에는 카드 자리에 스켈레톤(칩 3~4개 크기의 pill, `background:#F1F0EE`).
- **에러**: 조회 실패 시 6번 카드 셸을 재사용, 안내문 + "다시 시도" 보조 버튼 하나만.
- **확정 후 상태**: 주 버튼을 누른 뒤에는 카드를 비활성 요약 상태로 잠그고(칩 그룹 제거, 버튼 → "예약됨" 텍스트) 후속 조작은 새 메시지로 이어가세요. 지나간 메시지의 카드가 계속 조작 가능하면 히스토리가 신뢰를 잃습니다.
- **인증 화면 입력 포커스**: 파란 브라우저 기본 outline을 제거하고 보더 색만 `#111111`로 바꿉니다. 접근성을 위해 키보드 포커스 시에는 `box-shadow: 0 0 0 3px rgba(17,17,17,0.08)`를 추가하는 것을 권장합니다.
- **칩 클릭(선호 회의실)**: 다중 선택 + **선택 순서 유지**. 이미 선택된 칩을 다시 누르면 해제되고 뒤 순서 번호가 앞당겨집니다. 서버에는 배열 순서 그대로 우선순위로 전송하세요.
- **비밀번호 일치 검사**: 확인 필드에 입력이 있을 때만 판정. 실시간(onInput)으로 갱신하고, 제출 버튼은 필수값 미충족 시 비활성(`opacity .5`, 클릭 불가) 처리를 권장합니다.
- **등록 신청 제출 후**: 같은 카드 자리에서 "신청이 접수됐어요 · 승인되면 메일로 알려드려요" 상태로 교체하고, 폼은 감춥니다.
- **메시지 그룹핑 기준**: 동일 발화자 + 연속. 시간 간격은 보지 않고 발화자만 봅니다(챗봇 대화는 보통 연속 입력이라 간격 기준을 넣으면 그룹이 너무 자주 쪼개집니다). 그룹의 표시 시간은 **마지막** 메시지 시간입니다.
- **스트리밍 응답**: 어시스턴트가 생성 중이면 그룹 마지막에 버블 모양의 타이핑 인디케이터(`#F1F0EE` 배경, 회색 점 3개 순차 페이드)를 넣으세요. 시간은 스트리밍이 끝난 뒤에 붙입니다.
- **자동 스크롤**: 새 메시지가 붙을 때 사용자가 이미 맨 아래에 있을 때만 하단으로 이동시키고, 위로 올려봐 있는 상태라면 "새 메시지" 배지를 띄우세요.
- **반응형**: 460px는 데스크톱 채팅 컬럼 기준. 대화 컬럼 `760px` + 패널 `268px`이 들어가는 폭(약 1080px) 아래에서는 패널을 숨기고 모바일처럼 "내 정보" 시트로 전환하세요. 모바일에서는 카드가 폭 100%, 칩은 그대로 wrap. 터치 타깃 44px 확보를 위해 모바일에서는 칩 세로 패딩을 `9px`로 키우세요.
- **접근성**: 칩과 리스트 행은 실제 `<button>` / `role="radio"`로 구현하고 `aria-pressed` / `aria-checked`를 제공해 색만으로 선택을 표현하지 마세요. 취소 버튼의 접근성 라벨에는 대상 회의실명을 포함합니다.

## State Management

메시지 카드 하나당 로컬 상태는 최소로 유지합니다.

| 상태 | 타입 | 초기값 | 전환 |
| --- | --- | --- | --- |
| `selectedRoomId` | string | 서버 추천 회의실 id | 칩/행 클릭 |
| `selectedBookingId` | string \| null | `null` | 취소 대상 행 클릭 |
| `cardStatus` | `'active' \| 'submitting' \| 'done' \| 'error'` | `'active'` | 주 버튼 클릭 → `submitting` → 응답에 따라 `done`/`error` |
| `showPassword` | boolean | `false` | 표시/숨기기 토글 (로그인) |
| `rememberMe` | boolean | `true` | 체크박스 클릭 (로그인) |
| `preferredRoomIds` | string[] | `[]` | 선호 회의실 칩 클릭 (순서 = 우선순위) |
| `appPassword` / `appPasswordConfirm` | string | `''` | onInput; 두 값 비교로 일치 상태 파생 |
| `isPanelSheetOpen` | boolean | `false` | 모바일 "내 정보" 버튼 / 스크림 클릭 · Esc · 드래그 닫기 |
| `messages[]` | Message[] | 서버 | 발화자·연속 기준으로 **렌더 시에** 그룹으로 묶음(서버 스키마는 평범한 배열 유지) |

메시지 항목: `{ id, role: 'assistant' | 'user', text, createdAt, card? }` — `card`가 있으면 버블 아래에 1–6번 카드를 렌더링합니다.

데이터 요구사항 (서버 → 카드):

- `rooms[]`: `{ id, floor, capacity, isPreferred }` — 가용 목록 응답
- `slot`: `{ date, startTime, endTime }` — 카드 헤더의 날짜/시간 표기
- `bookings[]`: `{ id, roomId, title, startTime, endTime, status }` — 내 예약/취소 흐름
- 추천 로직(선호 회의실, 정원 적합도, 층 근접도)은 서버가 정하고 카드는 받은 순서를 그대로 렌더링합니다.

## Design Tokens

**Colors**

| 용도 | 값 |
| --- | --- |
| 페이지 배경 | `#FAFAF9` |
| 카드/패널 배경 | `#FFFFFF` |
| 카드 하단 바 배경 | `#FBFBFA` |
| 본문 텍스트 | `#1C1C1B` |
| 보조 텍스트(진함) | `#3C3C3A` |
| 보조 텍스트 | `#6E6E6A` |
| 뮤트 텍스트 | `#8B8B87` |
| 뮤트 텍스트(약함) | `#9A9A95` |
| 외곽 보더 | `#E8E7E4` |
| 카드 보더 | `#DFDEDA` |
| 칩 보더 | `#E4E3DF` |
| 보더 hover | `#B9B8B3` |
| 구분선 | `#F0EFED` |
| 어시스턴트 버블 배경 | `#F1F0EE` |
| 중립 태그 배경 | `#F2F1EF` |
| 선택 행 배경(중립) | `#F4F3F1` |
| 행 hover 배경 | `#FAFAF9` |
| 주 색상(버튼/사용자 버블) | `#111111` (hover `#000000`) |
| 브랜드 오렌지(아바타/다음 일정) | `#E8552A` |
| 오렌지 텍스트 / 배경 | `#B23F1D` / `#FBEBE4` |
| 성공 그린 텍스트 / 배경 | `#1E7A4B` / `#E8F5EC` |
| 추천 앰버 텍스트 / 배경 | `#7A5C00` / `#FCF1CF` |
| 위험 레드 텍스트 / 보더 / 배경 | `#C0362C` / `#EBC9C4` / `#FCF5F4` (hover `#FCF1EF`) |
| 인증 화면 페이지 배경 | `#F4F3F1` |
| 인풋 placeholder | `#B8B7B2` |
| 일치(성공) 인풋 보더 | `#BFE0CB` |
| 인풋 포커스 링 | `0 0 0 3px rgba(17,17,17,0.08)` |
| 채팅 우측 패널 배경 | `#FBFBFA` |
| 헤더 hover 배경 | `#F4F3F1` |
| 헤더 구분자 / 연한 보더 | `#EDECE9` |
| 아바타 플레이스홀더 배경 / 텍스트 | `#EAE9E6` / `#6E6E6A` |
| 온라인 상태 점 | `#3FA96B` |
| 정보 배너 배경 / 보더 / 레일 | `#FCF9EF` / `#F4EBD2` / `#E8C35A` |
| 모바일 시트 스크림 | `rgba(28,28,27,0.28)` |

**Typography** — Pretendard (fallback: `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif`)

| 역할 | 값 |
| --- | --- |
| 카드 제목(회의실명 대) | 18px / 700 / `letter-spacing:-0.01em` |
| 취소 완료 요약 | 15px / 600 |
| 본문·버블·행 제목 | 14px / 400~600 / `line-height:1.5` |
| 주 버튼 | 13.5px / 600 |
| 보조 버튼·칩·행 시간 | 13px / 500~600 |
| 캡션·라벨 | 12~12.5px / 600 |
| 배지·칩 보조 | 11~11.5px / 600 |

숫자(시간·정원·건수)는 모두 `font-variant-numeric: tabular-nums`.

**Spacing** — 2 / 5 / 6 / 7 / 8 / 10 / 12 / 14 / 18 / 20 px (4px 배수에 엄격하지 않음, 위 수치를 그대로 사용)

**Radius** — 칩·보조 버튼 `8–9px`, 인풋 `10px`, 인증 주 버튼 `11px`, 카드 `14px`, 패널·인증 폼 카드 `16px`, 인증 페이지 셸 `20px`, 버블 `16px`(꼬리쪽 모서리만 `4px`), 배지 `5–6px`, 원형 `50%`

**Control height** — 인풋 `44px`, 인증 주 버튼 `46px`

**Shadow** — 패널만 `0 1px 2px rgba(0,0,0,0.03)`. 카드·칩에는 그림자 없음.

## Assets
외부 이미지·아이콘 없음. 아바타는 텍스트 "A"가 든 원, 상태 표시는 색상 레일과 점(도형)으로만 처리했습니다.
아이콘을 추가한다면 코드베이스의 기존 아이콘 세트를 쓰고 16px·`currentColor` 기준으로 맞추세요.
폰트는 Pretendard(오픈소스, SIL OFL)를 CDN에서 불러왔습니다. 사내 앱에 이미 쓰는 한글 폰트가 있다면 그것을 우선하세요.

## Files
- `chat-screen.dc.html` — 채팅 화면 PC(`4a`) · 모바일(`4b`). 위 9·10번 항목. **이 셸이 전체 앱의 출발점입니다 — 이것부터 구현하고 그 안에 카드를 넣으세요.**
  모바일 바텀시트는 파일을 브라우저에서 열어 4b 오른쪽 [바텀시트 열어보기] 버튼으로 확인할 수 있습니다.
- `auth-login-signup.dc.html` — 로그인(`3a`) · 계정 등록 신청(`3b`). 위 7·8번 항목.
- `meeting-room-chat-ui.dc.html` — 챗봇 메시지 카드(1–6번). 채팅 화면 어시스턴트 버블 아래에 붙는 구조화된 응답들입니다.

## 구현 순서 제안
1. `chat-screen.dc.html`의 PC 셸(헤더 · 대화 컬럼 · 컴포저 · 우측 패널) + 메시지 그룹핑.
2. 모바일 뷰포트 대우 + 바텀시트.
3. 인증 화면 2장(공통 인풋/버튼 컴포넌트가 여기서 나옵니다).
4. 메시지 카드 1–6번을 버블 아래 렌더러로 추가. 칩·배지·행 리스트는 재사용 컴포넌트로 뽑아내세요(칩은 채팅 퀵액션·카드 후보·선호 회의실 세 곳에서 동일하게 사용됩니다).
  상단 섹션: 시나리오 5종(`2a` 내 예약 조회 · `2b` 전체 가용 목록 · `2c` 취소 대상 되묻기 · `2d` 취소 완료 · `2e` 대안 제시).
  하단 섹션: 추천 우선형 기본 예약 흐름.
  브라우저에서 바로 열립니다. 각 옵션 래퍼의 `id` 값이 위 문서의 번호와 대응합니다.
