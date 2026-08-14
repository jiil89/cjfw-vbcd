// [2026-08-14, 사용자 요청] 이 앱 로그인(JWT) 시점에 CJ 세션까지 함께 확보해두면(§
// auth.routes.ts), 이후 채팅에서 회의실 조회/예약 도구를 쓸 때 매번 처음부터 로그인하지
// 않고 이 캐시를 재사용해 응답 속도를 개선한다.
//
// 메모리 캐시(프로세스 내부 Map)라는 한계를 분명히 알아야 한다: 지금(로컬 개발/단일
// Express 프로세스)은 잘 동작하지만, 나중에 Vercel Functions(서버리스)로 배포하면 요청마다
// 다른 프로세스/컨테이너가 뜰 수 있어 이 캐시가 사실상 매번 비어있는 것처럼 동작할 수
// 있다(DB-2 완료 후 실사용 재검증 필요 — 이 경우 Redis 등 외부 캐시로 교체해야 함).
//
// TTL은 도메인 정의서 9번이 실측으로 관찰한 "CJ 세션 유효시간이 수 분 단위로 짧게 끊김"
// 보다 안전하게 짧게 잡는다(정확한 수명은 확인된 적 없음 — 추정치). 캐시된 세션이 TTL
// 안에서도 CJ 쪽에서 먼저 끊길 수 있고, 이 경우 API 호출이 실패한다 — 자동 무효화/재시도는
// 아직 구현하지 않았다(범위 밖, 다음 세션 검토 대상). 실패하면 사용자가 다시 시도하면
// TTL 만료 후 자연스럽게 새 로그인으로 넘어간다.
import type { CjSession } from "./session";

const SESSION_CACHE_TTL_MS = 2 * 60 * 1000; // 2분 — 관찰된 "수 분" 수명보다 보수적으로 짧게

interface CachedEntry {
  session: CjSession;
  obtainedAt: number;
}

const cache = new Map<string, CachedEntry>();

export function getCachedCjSession(userId: string): CjSession | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.obtainedAt > SESSION_CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.session;
}

export function setCachedCjSession(userId: string, session: CjSession): void {
  cache.set(userId, { session, obtainedAt: Date.now() });
}

export function clearCachedCjSession(userId: string): void {
  cache.delete(userId);
}
