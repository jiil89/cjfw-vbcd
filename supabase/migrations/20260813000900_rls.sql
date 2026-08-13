-- Row Level Security 정책
--
-- [아키텍처 전제] 이 시스템의 실제 클라이언트는 두 종류뿐이다.
--   1) 등록 웹페이지 (Vercel, 공개, anon key) - 사내 계정 ID/PW와 선호 회의실을 받아
--      account_registration_requests에 INSERT만 한다. 로그인 세션 개념이 없는 익명 공개 폼이다.
--   2) 봇 백엔드 / Admin 패널 백엔드 (신뢰된 서버, service role key) - 실제 예약 로직, 화이트리스트
--      대조, 승인/거부 처리, 텔레그램 사용자 식별 등 민감한 작업을 전부 수행한다.
--
--   Telegram 사용자도, Admin도 Supabase Auth 세션을 직접 들고 있지 않다 (Admin 인증은 사내 계정
--   기반이지 Supabase Auth가 아니며, 텔레그램 사용자는 애초에 브라우저 세션이 없다). 따라서
--   "auth.uid() = users.id" 형태의 표준 RLS 패턴은 이 아키텍처에 맞지 않는다.
--   "사용자는 본인 데이터만 접근 가능"이라는 요구사항은 여기서는 DB 세션 단위가 아니라
--   "신뢰된 봇 백엔드가 텔레그램 사용자ID로 필터링해서 접근한다"는 애플리케이션 레벨 보장으로
--   구현된다 (봇 백엔드는 service role key로 RLS를 우회하되, 항상 요청자의 telegram_user_id로
--   WHERE 필터링한 쿼리만 실행하도록 서버 코드에서 강제한다).
--
--   즉 RLS의 실질적 역할은 "공개 anon key로 노출된 등록 웹페이지가 실수로/악의적으로 다른 사람의
--   데이터를 읽거나 쓰지 못하게 막는 것"이다. anon/authenticated 롤에는 꼭 필요한 최소 권한(등록
--   신청 INSERT, 예약 가능 회의실 목록 SELECT)만 열어주고, 나머지는 정책을 아예 만들지 않아
--   기본값(모두 거부)으로 막는다. service role은 RLS를 우회하므로 모든 정책과 무관하게 항상 접근 가능하다.
--
--   (참고: 나중에 Admin 패널을 Supabase Auth 로그인 기반으로 바꾸거나, 사용자용 마이페이지를
--   추가하게 되면 auth.uid() 매핑 컬럼과 정책을 추가하면 된다. 지금 요구사항에는 없으므로
--   미리 만들어두지 않는다 - 오버엔지니어링 방지.)

alter table public.users enable row level security;
alter table public.admin_whitelist enable row level security;
alter table public.account_registration_requests enable row level security;
alter table public.rooms enable row level security;
alter table public.user_preferred_rooms enable row level security;
alter table public.reservation_requests enable row level security;
alter table public.reservations enable row level security;
alter table public.alternative_suggestions enable row level security;

-- rooms: 등록 웹페이지가 "선호 회의실" 선택 UI를 보여주기 위해 예약 가능한 회의실 목록을
-- anon key로 읽을 수 있어야 한다. 민감정보가 아니므로 공개 조회를 허용한다.
create policy rooms_public_read_bookable
  on public.rooms
  for select
  to anon, authenticated
  using (is_bookable = true);

-- account_registration_requests: 누구나(anon) 등록 신청을 "생성"할 수 있어야 한다 (공개 폼).
-- 단, 신청 직후 상태는 반드시 pending이고 텔레그램 연동 전(telegram_user_id NULL)이어야 하며,
-- 승인/거부 관련 컬럼은 절대 클라이언트가 직접 채울 수 없다.
create policy account_registration_requests_public_insert
  on public.account_registration_requests
  for insert
  to anon
  with check (
    status = 'pending'
    and telegram_user_id is null
    and processed_by_user_id is null
    and processed_by_system = false
    and processed_at is null
    and resulting_user_id is null
  );

-- SELECT/UPDATE/DELETE 정책은 anon/authenticated에 대해 만들지 않는다.
-- -> 본인 비밀번호(암호화본)를 포함해 신청 내역을 다시 읽거나 고치는 것은 웹페이지에서 불가능하며,
--    Admin 승인/거부는 오직 service role을 쓰는 신뢰된 백엔드(Admin 패널 백엔드)에서만 수행된다.
--    이것이 "Admin만 승인/거부 가능"의 실질적 강제 지점이다: RLS가 아니라 "service role key를
--    가진 것은 신뢰된 백엔드뿐"이라는 키 분리 + 백엔드 자체의 Admin 인증(사내 계정 기반)으로 보장한다.

-- users, admin_whitelist, user_preferred_rooms, reservation_requests, reservations,
-- alternative_suggestions: anon/authenticated용 정책을 전혀 만들지 않는다.
-- RLS가 켜져 있고 정책이 없으면 기본값은 "모두 거부"이므로, 이 테이블들은 anon/authenticated
-- 키로는 어떤 행도 읽거나 쓸 수 없다. service role key를 쓰는 봇 백엔드만 접근 가능하다.
