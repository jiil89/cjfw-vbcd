// recurring_reservation_rules / recurring_reservation_rule_rooms / recurring_reservation_runs
// 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스) → 애플리케이션
// 타입(camelCase) 변환은 이 계층에서만 한다.
//
// 스키마: supabase/migrations/20260817000000_recurring_reservations.sql 참고.
//
// [userId를 받는 함수는 반드시 WHERE에 user_id를 포함] RLS는 이 세 테이블에 정책 없이
// 켜져있기만 해서(service role만 접근 가능) 실질적인 접근 통제가 아니다 — "본인 규칙만
// 건드릴 수 있다"는 이 리포지토리가 매번 user_id로 필터링해야만 보장되는 애플리케이션
// 레벨 책임이다(8-schema.sql 9번 RLS 주석, 5-project-principle.md §5).

import { pool } from "../pool";
import type { Room } from "./roomRepository";

// timestamptz 컬럼은 node-postgres가 실제로는 Date 객체로 돌려준다(reservationRepository.ts와
// 동일한 이유). 타입 선언이 거짓말이 되지 않도록 이 계층에서 항상 문자열로 정규화한다.
function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export interface RecurringRuleRoomEntry {
  priority: number;
  room: Room;
}

export interface RecurringRuleWithRooms {
  id: string;
  userId: string;
  weekday: number; // 0=일요일 ~ 6=토요일 (JS Date.getDay() 규약)
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  title: string;
  contents: string | null;
  isActive: boolean;
  rooms: RecurringRuleRoomEntry[]; // priority 오름차순(1이 최우선)
  createdAt: string;
  updatedAt: string;
}

export type RecurringRunStatus = "succeeded" | "failed" | "skipped";

export interface RecurringRuleLatestRun {
  targetDate: string; // "YYYY-MM-DD"
  status: RecurringRunStatus;
  bookedRoomName: string | null;
  attemptedPriority: number | null;
  failureReason: string | null;
  executedAt: string;
}

export interface RecurringRuleForUser extends RecurringRuleWithRooms {
  latestRun: RecurringRuleLatestRun | null;
}

export interface RecurringRun {
  id: string;
  ruleId: string;
  targetDate: string;
  status: RecurringRunStatus;
  reservationId: string | null;
  bookedRoomId: string | null;
  attemptedPriority: number | null;
  failureReason: string | null;
  executedAt: string;
}

interface RuleRoomRow {
  rule_id: string;
  user_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  title: string;
  contents: string | null;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  priority: number | null;
  room_id: string | null;
  site: string | null;
  area_code: string | null;
  sub_area_code: string | null;
  room_code: string | null;
  room_name: string | null;
  floor_label: string | null;
  capacity: number | null;
  is_bookable: boolean | null;
  room_created_at: string | Date | null;
  room_updated_at: string | Date | null;
}

// rrr/rooms를 left join하는 이유: rule_rooms/rooms가 어떤 이유로든 비어있는(회의실이 전부
// 삭제된) 규칙이 있어도 findRulesByUserId 결과에서 규칙 자체가 통째로 사라지지 않게 한다
// (inner join이면 그 규칙이 조용히 응답에서 빠져버린다).
const RULE_ROOM_JOIN_QUERY = `
  select rr.id as rule_id, rr.user_id, rr.weekday,
         rr.start_time::text as start_time, rr.end_time::text as end_time,
         rr.title, rr.contents, rr.is_active, rr.created_at, rr.updated_at,
         rrr.priority,
         r.id as room_id, r.site, r.area_code, r.sub_area_code, r.room_code, r.room_name,
         r.floor_label, r.capacity, r.is_bookable,
         r.created_at as room_created_at, r.updated_at as room_updated_at
  from public.recurring_reservation_rules rr
  left join public.recurring_reservation_rule_rooms rrr on rrr.rule_id = rr.id
  left join public.rooms r on r.id = rrr.room_id
`;

function groupRuleRoomRows(rows: RuleRoomRow[]): RecurringRuleWithRooms[] {
  const byRuleId = new Map<string, RecurringRuleWithRooms>();

  for (const row of rows) {
    let rule = byRuleId.get(row.rule_id);
    if (!rule) {
      rule = {
        id: row.rule_id,
        userId: row.user_id,
        weekday: row.weekday,
        // time 컬럼은 "HH:mm:ss"로 돌아오므로 초 단위를 잘라 API/도구 계층 공통 표기("HH:mm")로 맞춘다.
        startTime: row.start_time.slice(0, 5),
        endTime: row.end_time.slice(0, 5),
        title: row.title,
        contents: row.contents,
        isActive: row.is_active,
        rooms: [],
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
      };
      byRuleId.set(row.rule_id, rule);
    }
    if (row.room_id) {
      rule.rooms.push({
        priority: row.priority as number,
        room: {
          id: row.room_id,
          site: row.site as string,
          areaCode: row.area_code as string,
          subAreaCode: row.sub_area_code as string,
          roomCode: row.room_code as string,
          roomName: row.room_name as string,
          floorLabel: row.floor_label,
          capacity: row.capacity,
          isBookable: row.is_bookable as boolean,
          createdAt: toIsoString(row.room_created_at as string | Date),
          updatedAt: toIsoString(row.room_updated_at as string | Date),
        },
      });
    }
  }

  for (const rule of byRuleId.values()) {
    rule.rooms.sort((a, b) => a.priority - b.priority);
  }
  return [...byRuleId.values()];
}

/** 스케줄러 잡이 대상일의 요일에 해당하는 활성 규칙을 회의실 우선순위 순으로 조회한다. */
export async function findActiveRulesForWeekday(weekday: number): Promise<RecurringRuleWithRooms[]> {
  const result = await pool.query<RuleRoomRow>(
    `${RULE_ROOM_JOIN_QUERY} where rr.weekday = $1 and rr.is_active = true order by rr.id, rrr.priority asc`,
    [weekday]
  );
  return groupRuleRoomRows(result.rows);
}

interface LatestRunRow {
  rule_id: string;
  target_date: string;
  status: RecurringRunStatus;
  attempted_priority: number | null;
  failure_reason: string | null;
  executed_at: string | Date;
  booked_room_name: string | null;
}

function toLatestRun(row: LatestRunRow): RecurringRuleLatestRun {
  return {
    targetDate: row.target_date,
    status: row.status,
    bookedRoomName: row.booked_room_name,
    attemptedPriority: row.attempted_priority,
    failureReason: row.failure_reason,
    executedAt: toIsoString(row.executed_at),
  };
}

/** GET /me/recurring-rules — 본인 규칙 + 회의실 + 최근 실행 1건. */
export async function findRulesByUserId(userId: string): Promise<RecurringRuleForUser[]> {
  const ruleRoomsResult = await pool.query<RuleRoomRow>(
    `${RULE_ROOM_JOIN_QUERY} where rr.user_id = $1 order by rr.id, rrr.priority asc`,
    [userId]
  );
  const rules = groupRuleRoomRows(ruleRoomsResult.rows);
  if (rules.length === 0) {
    return [];
  }

  const ruleIds = rules.map((rule) => rule.id);
  const latestRunResult = await pool.query<LatestRunRow>(
    `select distinct on (run.rule_id) run.rule_id, run.target_date::text as target_date, run.status,
            run.attempted_priority, run.failure_reason, run.executed_at,
            br.room_name as booked_room_name
     from public.recurring_reservation_runs run
     left join public.rooms br on br.id = run.booked_room_id
     where run.rule_id = any($1::uuid[])
     order by run.rule_id, run.executed_at desc`,
    [ruleIds]
  );
  const latestByRuleId = new Map(latestRunResult.rows.map((row) => [row.rule_id, toLatestRun(row)]));

  return rules.map((rule) => ({ ...rule, latestRun: latestByRuleId.get(rule.id) ?? null }));
}

export interface CreateRuleParams {
  userId: string;
  weekday: number;
  startTime: string; // "HH:mm"
  endTime: string;
  title: string;
  contents: string | null;
  roomIds: string[]; // 배열 순서 = 우선순위(1부터), 1~3개
}

/** 규칙 + 회의실 우선순위 목록을 한 트랜잭션으로 생성한다. */
export async function createRule(params: CreateRuleParams): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const ruleResult = await client.query<{ id: string }>(
      `insert into public.recurring_reservation_rules
         (user_id, weekday, start_time, end_time, title, contents)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [params.userId, params.weekday, params.startTime, params.endTime, params.title, params.contents]
    );
    const ruleId = ruleResult.rows[0].id;

    const values = params.roomIds.map((_, index) => `($1, $${index + 2}, ${index + 1})`).join(", ");
    await client.query(
      `insert into public.recurring_reservation_rule_rooms (rule_id, room_id, priority) values ${values}`,
      [ruleId, ...params.roomIds]
    );

    await client.query("commit");
    return { id: ruleId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** @returns 실제로 삭제됐으면 true, 본인 소유가 아니거나 없으면 false(호출자가 404 처리). */
export async function deleteRule(userId: string, ruleId: string): Promise<boolean> {
  const result = await pool.query(
    `delete from public.recurring_reservation_rules where id = $1 and user_id = $2`,
    [ruleId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** @returns 실제로 변경됐으면 true, 본인 소유가 아니거나 없으면 false(호출자가 404 처리). */
export async function setRuleActive(userId: string, ruleId: string, isActive: boolean): Promise<boolean> {
  const result = await pool.query(
    `update public.recurring_reservation_rules set is_active = $3 where id = $1 and user_id = $2`,
    [ruleId, userId, isActive]
  );
  return (result.rowCount ?? 0) > 0;
}

/** 무인 예약 동의 철회 시 그 사용자의 모든 규칙을 즉시 비활성화한다(routes/me.routes.ts에서 호출). */
export async function deactivateAllRulesByUserId(userId: string): Promise<void> {
  await pool.query(
    `update public.recurring_reservation_rules set is_active = false where user_id = $1 and is_active = true`,
    [userId]
  );
}

export interface RecordRunParams {
  ruleId: string;
  targetDate: string; // "YYYY-MM-DD"
  status: RecurringRunStatus;
  reservationId?: string | null;
  bookedRoomId?: string | null;
  attemptedPriority?: number | null;
  failureReason?: string | null;
}

/** 스케줄러 잡의 실행 결과 1건을 기록한다. unique(rule_id, target_date)가 멱등성 키다 —
 * 호출 전에 findRunByRuleAndDate로 이미 실행됐는지 반드시 먼저 확인해야 한다(중복 호출 시
 * unique violation으로 예외가 던져진다). */
export async function recordRun(params: RecordRunParams): Promise<void> {
  await pool.query(
    `insert into public.recurring_reservation_runs
       (rule_id, target_date, status, reservation_id, booked_room_id, attempted_priority, failure_reason)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.ruleId,
      params.targetDate,
      params.status,
      params.reservationId ?? null,
      params.bookedRoomId ?? null,
      params.attemptedPriority ?? null,
      params.failureReason ?? null,
    ]
  );
}

function toRun(row: {
  id: string;
  rule_id: string;
  target_date: string;
  status: RecurringRunStatus;
  reservation_id: string | null;
  booked_room_id: string | null;
  attempted_priority: number | null;
  failure_reason: string | null;
  executed_at: string | Date;
}): RecurringRun {
  return {
    id: row.id,
    ruleId: row.rule_id,
    targetDate: row.target_date,
    status: row.status,
    reservationId: row.reservation_id,
    bookedRoomId: row.booked_room_id,
    attemptedPriority: row.attempted_priority,
    failureReason: row.failure_reason,
    executedAt: toIsoString(row.executed_at),
  };
}

/** (rule_id, target_date) 멱등성 키로 이미 실행된 기록이 있는지 조회한다. */
export async function findRunByRuleAndDate(ruleId: string, targetDate: string): Promise<RecurringRun | null> {
  const result = await pool.query(
    `select id, rule_id, target_date::text as target_date, status, reservation_id, booked_room_id,
            attempted_priority, failure_reason, executed_at
     from public.recurring_reservation_runs
     where rule_id = $1 and target_date = $2`,
    [ruleId, targetDate]
  );
  return result.rows[0] ? toRun(result.rows[0]) : null;
}
