-- 챗봇 대화 세션(오케스트레이션 상태) 저장 테이블.
--
-- [배경] backend/src/orchestration/sessionStore.ts가 지금까지 모듈 전역 `Map`으로만
-- 대화 이력/확인대기(pendingConfirmation)/서버측 판정 근거(offeredSlots 등)를 들고
-- 있었다. 로컬(항상 같은 프로세스가 떠있음)에서는 문제가 없었지만, Vercel 서버리스에
-- 배포하면 요청마다 함수 인스턴스가 새로 뜨거나 갈아치워질 수 있어 그 순간 대화 기억이
-- 통째로 날아간다 — "방금 예약한 거 취소해줘"를 못 알아듣거나, 확인 없이 바로 실행되던
-- 로직(3-5b, offeredSlots 근거)이 매번 근거 없음으로 판정되는 등 실사용에 바로 영향을 준다.
--
-- [설계] OrchestrationSession 객체가 이미 사용자 1명당 하나의 덩어리라, 필드를 컬럼으로
-- 쪼개지 않고 jsonb 하나로 통째로 저장한다 — sessionStore.ts의 순수 상태 저장소 역할을
-- 그대로 유지하면서(다른 계층을 모름), 이 테이블 하나만 얹는 최소 변경.
--
-- [동시성] 락을 걸지 않는다. 이 서비스는 사용자당 챗봇 대화가 1개라는 전제(도메인 정의서
-- 1번)이고, 프론트도 응답 대기 중 입력을 막아 같은 탭에서는 동시 요청이 나가지 않는다.
-- 남는 경우는 같은 사용자가 탭/기기를 여러 개 열어놓고 동시에 보내는 것뿐인데, 사내 소수
-- 인원 대상 내부 도구에서 발생 확률이 낮고 최악의 경우도 "메시지 하나가 씹힘" 수준이라
-- (실제 예약 오작동으로 이어지지 않음 — 그 안전장치는 pendingConfirmation 토큰 자체 검증이라
-- 세션 유실과 무관) 지금 스코프에서는 락을 넣지 않는다(오버엔지니어링 금지 원칙).

create table if not exists public.chat_sessions (
  user_id uuid primary key references public.users(id) on delete cascade,

  -- OrchestrationSession 전체(messages/pendingConfirmation/offeredSlots/turnIndex 등)를
  -- 그대로 직렬화해서 저장한다. 컬럼을 쪼개지 않는 이유는 파일 상단 [설계] 참고.
  state jsonb not null,

  -- 세션 타임아웃(SESSION_TIMEOUT_MS=30분) 판정에 쓰는 최근 활동 시각.
  last_activity_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_sessions is
  '사용자별 챗봇 오케스트레이션 세션(대화 이력 + 확인대기 상태). Vercel 서버리스에서 함수
   인스턴스가 바뀌어도 대화 기억이 유지되도록 sessionStore.ts의 in-memory Map을 대체한다.';
comment on column public.chat_sessions.state is
  'OrchestrationSession 전체를 그대로 직렬화한 jsonb (messages/pendingConfirmation/offeredSlots 등).';

alter table public.chat_sessions enable row level security;

-- anon/authenticated용 정책을 만들지 않는다. RLS가 켜져 있고 정책이 없으면 기본값은
-- "모두 거부"이므로, service role key를 쓰는 백엔드만 접근 가능하다
-- (refresh_tokens/20260813002000 마이그레이션과 동일한 근거).
