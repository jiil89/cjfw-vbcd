import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./ChatPage.css";
import { Badge, BrandMarkIcon, Button, Card, Chip } from "../../components";
import { HttpError } from "../../api/httpClient";
import { useAuthStore } from "../../stores/authStore";
import { useLogoutMutation } from "../../queries/authQueries";
import {
  useChangeAppPasswordMutation,
  useChangeCjWorldPasswordMutation,
  usePreferredRoomsQuery,
  useSendChatMessageMutation,
  useTodayReservationsQuery,
} from "../../queries/chatQueries";
import { useRoomsQuery } from "../../queries/registrationQueries";
import {
  useCreateRecurringRuleMutation,
  useDeleteRecurringRuleMutation,
  useGiveUnattendedConsentMutation,
  useRecurringRulesQuery,
  useRevokeUnattendedConsentMutation,
  useToggleRecurringRuleMutation,
  useUnattendedConsentQuery,
} from "../../queries/recurringQueries";
import type {
  CheckAvailabilityData,
  ChatProposal,
  ConfirmedResultData,
  FindReservationCandidatesData,
  GenericProposalData,
  GetMyReservationsData,
  MyReservationGroup,
  ProposeCreateReservationData,
  ProposeSplitReservationData,
  ReservationCandidate,
} from "../../types/chat";
import type { RecurringRule, RecurringRuleLatestRun } from "../../types/recurring";
import type { Room } from "../../types/room";

/** 이 앱에서 지원하는 6개 층의 정렬 순서 — 시스템 프롬프트(systemPrompt.ts)의
 * floorOrder와 동일한 기준을 프론트에도 맞춘다. */
const FLOOR_ORDER = ["3F", "12F", "13F", "14F", "15F", "16F"];

interface ChatUiMessage {
  id: string;
  role: "agent" | "user";
  text: string;
  timestamp: Date;
  proposal?: ChatProposal | null;
  pending?: boolean;
  isError?: boolean;
  /** 실패한 경우 백엔드가 준 에러 코드 — 아바타 아이콘(인증 문제 vs 일반 실패) 선택에 쓴다. */
  errorCode?: string;
}

/** 에이전트 아바타 아이콘 — 답변 상황에 맞는 캐릭터를 고른다.
 *
 * 어떤 도구가 실행됐는지는 이미 응답의 `proposal.tool`로 내려오므로, LLM에게 따로
 * "지금 표정이 뭐냐"고 물을 필요 없이 서버가 실제로 한 일을 근거로 결정론적으로 고른다. */
const AGENT_AVATAR_DEFAULT = "/webpage_icon.png";

function agentAvatarSrc(message: ChatUiMessage): string {
  if (message.pending) return "/webpage_icon_response_pending.png";

  if (message.isError) {
    // 세션 만료·CJ 로그인 실패처럼 "인증" 문제는 자물쇠 캐릭터로 구분한다.
    const isAuthProblem =
      message.errorCode === "SESSION_EXPIRED" ||
      message.errorCode === "CJ_LOGIN_FAILED" ||
      message.errorCode === "UNAUTHORIZED";
    return isAuthProblem ? "/webpage_icon_security.png" : "/webpage_icon_reservation_fail.png";
  }

  const tool = message.proposal?.tool;
  if (!tool) return AGENT_AVATAR_DEFAULT;

  // 도구가 실패를 돌려준 경우(errorResult)도 실패 표정으로 맞춘다.
  const data = message.proposal?.data;
  if (data && typeof data === "object" && "error" in data) {
    return "/webpage_icon_reservation_fail.png";
  }

  if (tool.startsWith("confirm_")) return "/webpage_icon_reservation_success.png";
  if (tool.startsWith("propose_")) return "/webpage_icon_newroom_recomendation.png";
  if (
    tool === "check_availability" ||
    tool === "plan_long_meeting" ||
    tool === "recommend_rooms" ||
    tool === "get_my_reservations" ||
    tool === "find_reservation_candidates"
  ) {
    return "/webpage_icon_search.png";
  }
  return AGENT_AVATAR_DEFAULT;
}

const QUICK_COMMANDS = [
  { label: "오늘 내 예약 조회", message: "오늘 내 예약을 보여줘" },
  { label: "자주 쓰는 회의실로 예약", message: "자주 쓰는 회의실로 예약해줘" },
  { label: "예약 취소", message: "예약을 취소하고 싶어" },
];

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function formatDayDivider(date: Date): string {
  return `오늘 · ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_LABELS[date.getDay()]}요일`;
}

function formatTimestamp(date: Date): string {
  const hours = date.getHours();
  const period = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${period} ${hour12}:${minutes}`;
}

// [2026-08-14] 이 값은 백엔드 timestamptz 컬럼에서 온 진짜 UTC 인스턴트라(정규식으로 그냥
// 잘라내면 UTC 시각이 나온다 — 예: 09:00 KST 예약이 "00:00"으로 잘못 표시됨), 이 앱이
// 고정 지원하는 상암S시티(한국) 기준으로 명시적으로 변환해서 보여준다.
const KST_HHMM_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-08-17T00:00:00.000Z"(09:00 KST) -> "09:00" — 한국 시각 기준 벽시계 시각. */
function hhmm(iso: string): string {
  return KST_HHMM_FORMATTER.format(new Date(iso));
}

function capacityLabel(capacity: number | null): string {
  return capacity === null ? "인원 미상" : `${capacity}인`;
}

/** "2026-08-17" -> "8월 17일 (월)" — 타임존 영향 없이 달력 날짜 그대로 파싱한다. */
function formatDateWithWeekday(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${month}월 ${day}일 (${WEEKDAY_LABELS[date.getUTCDay()]})`;
}

function floorSortIndex(floorLabel: string | null): number {
  const index = FLOOR_ORDER.indexOf(floorLabel ?? "");
  return index === -1 ? FLOOR_ORDER.length : index;
}

interface ChatMessageGroupData {
  role: "agent" | "user";
  messages: ChatUiMessage[];
}

/** chat-screen.dc.html "메시지 그룹핑": 같은 발화자의 연속 메시지를 하나로 묶는다 —
 * 시간 간격은 안 보고 발화자 연속 여부만 본다(대화가 대부분 연속 입력이라 간격 기준을
 * 넣으면 그룹이 너무 자주 쪼개진다). 아바타/시간은 그룹당 한 번만 표시한다. */
function groupMessages(messages: ChatUiMessage[]): ChatMessageGroupData[] {
  const groups: ChatMessageGroupData[] = [];
  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.role === message.role) {
      lastGroup.messages.push(message);
    } else {
      groups.push({ role: message.role, messages: [message] });
    }
  }
  return groups;
}

/** roomList를 floorLabel 기준으로 묶고, 지원 층 순서(FLOOR_ORDER)로 정렬한다. */
function groupRoomsByFloor(rooms: Room[]): Array<{ floorLabel: string; rooms: Room[] }> {
  const byFloor = new Map<string, Room[]>();
  for (const room of rooms) {
    const floor = room.floorLabel ?? "(층 미상)";
    const list = byFloor.get(floor) ?? [];
    list.push(room);
    byFloor.set(floor, list);
  }
  return [...byFloor.entries()]
    .sort((a, b) => floorSortIndex(a[0]) - floorSortIndex(b[0]))
    .map(([floorLabel, floorRooms]) => ({ floorLabel, rooms: floorRooms }));
}

export function ChatPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logoutMutation = useLogoutMutation();
  const sendMutation = useSendChatMessageMutation();
  const todayQuery = useTodayReservationsQuery();
  const prefQuery = usePreferredRoomsQuery();

  const [messages, setMessages] = useState<ChatUiMessage[]>(() => [
    {
      id: "welcome",
      role: "agent",
      text: "안녕하세요! 회의실 예약을 도와드릴게요. 날짜·시간·인원만 말씀해 주시면 바로 확인해 드립니다.",
      timestamp: new Date(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isPanelSheetOpen, setIsPanelSheetOpen] = useState(false);
  // 모바일 전용 — 빠른명령 칩 줄을 접어두고 "+"로 펼친다(데스크톱은 항상 펼쳐진 상태라 이 값과 무관).
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  // 응답 대기 중엔 입력창이 disabled가 되는데, 브라우저가 disabled 요소의 포커스를
  // 강제로 뺏는다. 응답이 오면 disabled는 풀리지만 포커스는 저절로 안 돌아와서
  // 사용자가 매번 다시 클릭해야 했다 — 여기서 명시적으로 되돌려준다.
  useEffect(() => {
    if (!sendMutation.isPending) {
      composerInputRef.current?.focus();
    }
  }, [sendMutation.isPending]);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;

    const pendingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: trimmed, timestamp: new Date() },
      { id: pendingId, role: "agent", text: "확인 중입니다…", timestamp: new Date(), pending: true },
    ]);
    setDraft("");

    sendMutation.mutate(trimmed, {
      onSuccess: (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { id: pendingId, role: "agent", text: data.reply, timestamp: new Date(), proposal: data.proposal }
              : m
          )
        );
        // 예약 생성/변경/취소가 확정되면 사이드바 "오늘 예약"이 바뀌었을 수 있으니 다시 불러온다.
        if (data.proposal?.tool.startsWith("confirm_")) {
          todayQuery.refetch();
        }
        // 선호 회의실 추가/제거 직후 사이드바 "선호 회의실"도 바로 반영되게 다시 불러온다.
        if (data.proposal?.tool === "add_preferred_room" || data.proposal?.tool === "remove_preferred_room") {
          prefQuery.refetch();
        }
      },
      onError: (error) => {
        const message =
          error instanceof HttpError ? error.message : "메시지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        const errorCode = error instanceof HttpError ? error.code : undefined;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { id: pendingId, role: "agent", text: message, timestamp: new Date(), isError: true, errorCode }
              : m
          )
        );
      },
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
  }

  function handleLogout() {
    logoutMutation.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  }

  const avatarInitial = user?.email_alias?.[0]?.toUpperCase() ?? "?";

  // design_recom "확정 후 상태": 지나간 메시지의 카드는 더 이상 조작 가능하면 안 된다 —
  // 현재 대화에서 카드가 붙은 가장 최근 어시스턴트 메시지 하나만 실제로 클릭 가능하게 하고,
  // 그 이전 카드들은 시각적으로 잠근다(ProposalCard의 disabled 처리).
  const latestActionableAgentMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === "agent" && !m.pending && m.proposal) return m.id;
    }
    return null;
  }, [messages]);

  return (
    <div className="chat-page">
      <header className="chat-topbar">
        <div className="chat-brand">
          <span className="chat-brand-mark">
            <BrandMarkIcon size={22} />
          </span>
          <span className="chat-brand-name">회의실 예약</span>
          <span className="chat-brand-site mono">상암S시티</span>
        </div>
        <div className="chat-header-actions">
          <div className="chat-user-chip">
            <span className="chat-status-dot" aria-hidden="true" />
            <span className="chat-avatar">{avatarInitial}</span>
            <span className="chat-user-name">{user?.email_alias}</span>
          </div>
          {/* chat-screen.dc.html: Admin/로그아웃은 데스크톱 헤더에만 두고, 모바일에서는
              헤더 폭을 아끼기 위해 "내 정보" 시트로 옮긴다. */}
          <div className="chat-header-desktop-actions">
            {user?.is_admin && (
              <Link to="/admin" className="btn btn-ghost btn-sm">
                <span className="btn-label">Admin 패널</span>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} loading={logoutMutation.isPending}>
              로그아웃
            </Button>
          </div>
          <button type="button" className="chat-panel-trigger" onClick={() => setIsPanelSheetOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            내 정보
          </button>
        </div>
      </header>

      <div className="chat-body">
        <section className="chat-col">
          <div className="chat-thread" ref={threadRef}>
            <div className="chat-day-divider">{formatDayDivider(new Date())}</div>

            {groupMessages(messages).map((group) => (
              <ChatMessageGroup
                key={group.messages[0].id}
                group={group}
                onAction={sendMessage}
                latestActionableAgentMessageId={latestActionableAgentMessageId}
              />
            ))}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <div className={`chat-quick-chips${isQuickOpen ? " is-open" : ""}`}>
              {QUICK_COMMANDS.map((command) => (
                <Chip
                  key={command.label}
                  type="button"
                  disabled={sendMutation.isPending}
                  onClick={() => {
                    setIsQuickOpen(false);
                    sendMessage(command.message);
                  }}
                >
                  {command.label}
                </Chip>
              ))}
            </div>
            <div className="chat-input-row">
              {/* 모바일에서만 보이는 빠른명령 토글. 칩 줄이 늘 자리를 차지하면 컴포저가
                  138px까지 커져서 키보드가 올라왔을 때 대화가 거의 안 보였다. */}
              <button
                type="button"
                className="chat-quick-toggle"
                aria-label="빠른 명령"
                aria-expanded={isQuickOpen}
                onClick={() => setIsQuickOpen((open) => !open)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <input
                ref={composerInputRef}
                type="text"
                className="chat-input"
                placeholder="내일 오전 10시 회의실 잡아줘"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={sendMutation.isPending}
              />
              <button
                type="submit"
                className="chat-send-btn"
                aria-label="보내기"
                disabled={sendMutation.isPending || draft.trim() === ""}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22 11 13 2 9z" />
                </svg>
              </button>
            </div>
            <p className="chat-composer-hint">Enter로 보내기</p>
          </form>
        </section>

        <aside className="chat-rail">
          <ChatRailContent
            todayGroups={todayQuery.data}
            todayLoading={todayQuery.isLoading}
            preferredRooms={prefQuery.data}
            preferredLoading={prefQuery.isLoading}
          />
        </aside>

        {isPanelSheetOpen && (
          <ChatPanelSheet
            onClose={() => setIsPanelSheetOpen(false)}
            todayGroups={todayQuery.data}
            todayLoading={todayQuery.isLoading}
            preferredRooms={prefQuery.data}
            preferredLoading={prefQuery.isLoading}
            isAdmin={Boolean(user?.is_admin)}
            onLogout={handleLogout}
            logoutPending={logoutMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

function ChatMessageGroup({
  group,
  onAction,
  latestActionableAgentMessageId,
}: {
  group: ChatMessageGroupData;
  onAction: (text: string) => void;
  latestActionableAgentMessageId: string | null;
}) {
  const isAgent = group.role === "agent";
  const lastMessage = group.messages[group.messages.length - 1];
  return (
    <div className={`chat-row-group ${isAgent ? "chat-row-group-agent" : "chat-row-group-user"}`}>
      {isAgent && (
        <span className="chat-avatar chat-group-avatar" aria-hidden="true">
          <img className="chat-avatar-img" src={agentAvatarSrc(lastMessage)} alt="" />
        </span>
      )}
      <div className="chat-bubble-stack">
        {group.messages.map((message) => (
          <div className="chat-bubble-item" key={message.id}>
            <div className={`chat-bubble ${message.isError ? "chat-bubble-error" : ""}`}>
              {message.pending ? (
                <span className="chat-bubble-pending">
                  <span className="chat-bubble-spinner" aria-hidden="true" />
                  확인 중입니다…
                </span>
              ) : (
                message.text
              )}
            </div>
            {!message.pending && message.proposal && (
              <ProposalCard
                proposal={message.proposal}
                onAction={onAction}
                locked={message.id !== latestActionableAgentMessageId}
              />
            )}
          </div>
        ))}
        <span className="chat-timestamp">{formatTimestamp(lastMessage.timestamp)}</span>
      </div>
    </div>
  );
}

// design_recom "확정 후 상태": 지나간 메시지의 카드는 잠가서(클릭 불가 + 흐리게) 더 이상
// 조작할 수 없게 한다 — 실제 액션은 새 메시지로만 이어가야 히스토리가 신뢰를 유지한다.
function ProposalCard({
  proposal,
  onAction,
  locked,
}: {
  proposal: ChatProposal;
  onAction: (text: string) => void;
  locked: boolean;
}): ReactNode {
  const content = renderProposalContent(proposal, onAction);
  if (!content) return null;
  if (!locked) return content;
  return (
    <div className="chat-proposal-locked" aria-disabled="true">
      {content}
    </div>
  );
}

function renderProposalContent(proposal: ChatProposal, onAction: (text: string) => void): ReactNode {
  // 도구 호출이 실패하면 orchestrator.ts의 errorResult()가 { error: string } 형태로
  // proposal.data에 그대로 실린다(어떤 tool이든 동일). 이 경우 각 case가 기대하는 성공
  // 응답 모양(room/segments/preferred 등)이 없어 그대로 destructure하면 크래시한다 —
  // 실패는 이미 reply 텍스트로 안내되므로 카드는 그냥 안 그린다.
  if (proposal.data && typeof proposal.data === "object" && "error" in proposal.data) {
    return null;
  }

  switch (proposal.tool) {
    case "check_availability": {
      const data = proposal.data as CheckAvailabilityData;
      // 요청한 층에 자리가 없으면 서버가 같은 시간대 다른 층 후보를 함께 실어준다 —
      // 그 경우에도 카드를 그려야 사용자가 클릭할 수 있다(안 그리면 텍스트만 남는다).
      const rooms = [...data.preferred, ...data.others, ...(data.sameTimeOtherFloors ?? [])];
      if (rooms.length === 0) return null;

      if (data.preferred.length > 0) {
        // 선호 회의실 중 비어있는 곳이 있으면 1순위를 추천 카드로 크게, 나머지는 칩으로.
        const recommended = data.preferred[0];
        const others = rooms.filter((room) => room.id !== recommended.id);
        return (
          <RoomRecommendationCard
            room={recommended}
            badgeLabel="추천"
            noteTag="선호 회의실"
            date={data.date}
            startTime={data.startTime}
            endTime={data.endTime}
            primaryLabel="이 회의실로 확정"
            onPrimary={() => onAction(`${recommended.roomName}으로 할래요`)}
          >
            {others.length > 0 && (
              <div className="chat-chip-section">
                <div className="chat-chip-section-label">다른 후보 {others.length}곳</div>
                <RoomChipGroup rooms={others} onSelect={(room) => onAction(`${room.roomName}으로 할래요`)} />
              </div>
            )}
          </RoomRecommendationCard>
        );
      }

      // 선호 회의실이 없거나 다 찼으면, 후보 전체를 층별로 묶어서 골라 담게 한다.
      return <FloorGroupedRoomsCard rooms={rooms} onConfirm={(room) => onAction(`${room.roomName}으로 할래요`)} />;
    }

    case "propose_create_reservation": {
      const data = proposal.data as ProposeCreateReservationData;
      return (
        <RoomRecommendationCard
          room={data.room}
          noteTag="예약가능"
          date={data.date}
          startTime={data.startTime}
          endTime={data.endTime}
          primaryLabel="이 회의실로 확정"
          onPrimary={() => onAction("네, 이 회의실로 확정해주세요")}
          secondaryLabel="다른 곳 보기"
          onSecondary={() => onAction("다른 회의실도 보여줘")}
        />
      );
    }

    case "propose_split_reservation": {
      const data = proposal.data as ProposeSplitReservationData;
      return (
        <Card radius="xl" className="chat-room-card">
          <ul className="chat-split-segment-list">
            {data.segments.map((segment, index) => (
              <li key={index}>
                <span className="chat-room-card-name">{segment.room.roomName}</span>
                <span className="chat-room-card-time mono">
                  {segment.startTime}~{segment.endTime}
                </span>
              </li>
            ))}
          </ul>
          <div className="chat-card-actions">
            <Button size="sm" onClick={() => onAction("네, 이 계획대로 확정해주세요")}>
              이 계획으로 확정
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("다른 방법도 보여줘")}>
              다른 방법 보기
            </Button>
          </div>
        </Card>
      );
    }

    case "propose_modify_reservation":
    case "propose_cancel_reservation": {
      const data = proposal.data as GenericProposalData;
      if (!data.requiresUserConfirmation) return null;
      const isCancel = proposal.tool === "propose_cancel_reservation";
      return (
        <Card radius="xl" className="chat-room-card">
          <p className="chat-generic-summary">{data.summary}</p>
          <div className="chat-card-actions">
            {/* 취소는 되돌리기 어려운 행동이라 danger 톤으로 구분한다(design_recom 핸드오프 문서 원칙). */}
            <Button
              size="sm"
              variant={isCancel ? "danger" : "primary"}
              onClick={() => onAction("네, 진행해주세요")}
            >
              {isCancel ? "취소하기" : "확정"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("아니요, 하지 마세요")}>
              그만둘게요
            </Button>
          </div>
        </Card>
      );
    }

    case "get_my_reservations": {
      const data = proposal.data as GetMyReservationsData;
      if (data.groups.length === 0) return null;
      return <MyReservationsListCard groups={data.groups} onAction={onAction} />;
    }

    case "find_reservation_candidates": {
      const data = proposal.data as FindReservationCandidatesData;
      if (data.status !== "ambiguous" || !data.candidates || data.candidates.length === 0) return null;
      return <ReservationPickerCard candidates={data.candidates} onAction={onAction} />;
    }

    case "confirm_create_reservation":
    case "confirm_split_reservation":
    case "confirm_modify_reservation":
    case "confirm_cancel_reservation": {
      const data = proposal.data as ConfirmedResultData;
      if (data.status !== "confirmed") return null;
      const label = proposal.tool.includes("cancel")
        ? "예약 취소 완료"
        : proposal.tool.includes("modify")
          ? "예약 변경 완료"
          : "예약 확정";
      return (
        <span className="chat-status-line">
          <span className="chat-status-dot-inline" aria-hidden="true" />
          {label}
        </span>
      );
    }

    default:
      return null;
  }
}

interface RoomRecommendationCardProps {
  room: Room;
  date?: string;
  startTime: string;
  endTime: string;
  badgeLabel?: string;
  noteTag?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
}

// "추천 우선형" 카드 — design_recom 핸드오프 문서의 큰 추천 카드 패턴.
// check_availability(선호 회의실 있음)와 propose_create_reservation 둘 다 이걸 쓴다.
function RoomRecommendationCard({
  room,
  date,
  startTime,
  endTime,
  badgeLabel,
  noteTag,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  children,
}: RoomRecommendationCardProps) {
  return (
    <Card radius="xl" bordered className="chat-reco-card">
      <div className="chat-reco-head">
        <div className="chat-reco-head-left">
          <span className="chat-reco-name">{room.roomName}</span>
          {badgeLabel && <Badge tone="warn">{badgeLabel}</Badge>}
        </div>
        <div className="chat-reco-head-right">
          {date && <span className="mono">{formatDateWithWeekday(date)}</span>}
          <span className="mono">
            {startTime}~{endTime}
          </span>
        </div>
      </div>
      <div className="chat-reco-tags">
        <Badge tone="success">{capacityLabel(room.capacity)}</Badge>
        {noteTag && <Badge tone="neutral">{noteTag}</Badge>}
      </div>
      <div className="chat-card-actions">
        <Button size="sm" onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </div>
      {secondaryLabel && onSecondary && (
        <button type="button" className="chat-reco-secondary" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      )}
      {children}
    </Card>
  );
}

function RoomChipGroup({ rooms, onSelect }: { rooms: Room[]; onSelect: (room: Room) => void }) {
  return (
    <div className="chat-chip-group">
      {rooms.map((room) => (
        <Chip key={room.id} onClick={() => onSelect(room)}>
          {room.roomName} · {capacityLabel(room.capacity)}
        </Chip>
      ))}
    </div>
  );
}

// "전체 가용 목록" 카드 — 선호 회의실이 없을 때 층별로 묶어 하나를 고르게 한다.
function FloorGroupedRoomsCard({ rooms, onConfirm }: { rooms: Room[]; onConfirm: (room: Room) => void }) {
  const floorGroups = useMemo(() => groupRoomsByFloor(rooms), [rooms]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rooms.find((room) => room.id === selectedId) ?? null;

  return (
    <Card radius="xl" bordered className="chat-floorlist-card">
      {floorGroups.map((group) => (
        <div key={group.floorLabel} className="chat-floorlist-group">
          <div className="chat-floorlist-floor-label">{group.floorLabel}</div>
          <div className="chat-chip-group">
            {group.rooms.map((room) => (
              <Chip
                key={room.id}
                selected={room.id === selectedId}
                onClick={() => setSelectedId(room.id)}
              >
                {room.roomName} · {capacityLabel(room.capacity)}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      <div className="chat-floorlist-footer">
        <span className="chat-floorlist-hint">
          {selected ? `${selected.roomName} 선택함` : "회의실을 골라주세요"}
        </span>
        <Button size="sm" disabled={!selected} onClick={() => selected && onConfirm(selected)}>
          이 회의실로 확정
        </Button>
      </div>
    </Card>
  );
}

// "내 예약 조회" 리스트 카드 — get_my_reservations 결과를 세그먼트 단위로 펼쳐 보여준다.
function MyReservationsListCard({
  groups,
  onAction,
}: {
  groups: MyReservationGroup[];
  onAction: (text: string) => void;
}) {
  const now = Date.now();
  const rows = groups.flatMap((group) =>
    group.segments.map((segment) => ({
      key: segment.reservationId,
      room: segment.roomName ?? "회의실 미상",
      title: group.title,
      startAt: segment.startAt,
      endAt: segment.endAt,
    })),
  );
  if (rows.length === 0) return null;

  const nextKey = rows.find((row) => new Date(row.endAt).getTime() > now)?.key;

  return (
    <Card radius="xl" bordered className="chat-mylist-card">
      <div className="chat-mylist-header">
        <span>오늘 예약</span>
        <span className="mono">{rows.length}건</span>
      </div>
      <ul className="chat-mylist-rows">
        {rows.map((row) => {
          const ended = new Date(row.endAt).getTime() <= now;
          const isNext = row.key === nextKey;
          return (
            <li key={row.key} className={`chat-mylist-row ${ended ? "chat-mylist-row-ended" : ""}`}>
              <span className={`chat-mylist-rail ${isNext ? "chat-mylist-rail-next" : ""}`} aria-hidden="true" />
              <span className="chat-mylist-info">
                <span className="chat-mylist-room-line">
                  <span className="chat-mylist-room">{row.room}</span>
                  {isNext && <span className="chat-mylist-next-badge">다음</span>}
                  {ended && <Badge tone="neutral">종료</Badge>}
                </span>
                <span className="chat-mylist-title">{row.title}</span>
              </span>
              <span className="chat-mylist-time mono">
                {hhmm(row.startAt)}~{hhmm(row.endAt)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="chat-mylist-footer">
        <Button size="sm" variant="ghost" onClick={() => onAction("예약 시간을 변경하고 싶어")}>
          시간 변경
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("예약을 취소하고 싶어")}>
          예약 취소
        </Button>
      </div>
    </Card>
  );
}

// "취소/변경 대상 되묻기" 카드 — find_reservation_candidates가 ambiguous일 때 표시.
// 목표 예약을 특정하는 단계일 뿐 실제 취소/변경은 이후 propose_*의 확인 카드에서 한 번 더
// 확정받으므로, 여기서는 danger 톤을 쓰지 않고 중립적으로 "선택"만 받는다.
function ReservationPickerCard({
  candidates,
  onAction,
}: {
  candidates: ReservationCandidate[];
  onAction: (text: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = candidates.find((c) => c.reservationId === selectedId) ?? null;

  return (
    <Card radius="xl" bordered className="chat-picker-card">
      <ul className="chat-picker-list">
        {candidates.map((candidate) => {
          const isSelected = candidate.reservationId === selectedId;
          return (
            <li key={candidate.reservationId}>
              <button
                type="button"
                className={`chat-picker-row ${isSelected ? "chat-picker-row-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedId(candidate.reservationId)}
              >
                <span className={`chat-picker-radio ${isSelected ? "chat-picker-radio-selected" : ""}`} aria-hidden="true" />
                <span className="chat-picker-row-info">
                  <span className="chat-picker-room">{candidate.roomName ?? "회의실 미상"}</span>
                  <span className="chat-picker-title">{candidate.title}</span>
                </span>
                <span className="chat-picker-time mono">
                  {hhmm(candidate.startAt)}~{hhmm(candidate.endAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="chat-picker-footer">
        <span className="chat-picker-hint">
          {selected ? `${selected.roomName ?? "이"} 예약을 선택했어요` : "예약을 골라주세요"}
        </span>
        <Button
          size="sm"
          disabled={!selected}
          onClick={() =>
            selected &&
            onAction(`${selected.roomName ?? ""} ${hhmm(selected.startAt)}~${hhmm(selected.endAt)} ${selected.title} 예약`)
          }
        >
          선택
        </Button>
      </div>
    </Card>
  );
}

function TodayReservationsRail({
  groups,
  isLoading,
}: {
  groups: MyReservationGroup[] | undefined;
  isLoading: boolean;
}) {
  return (
    <div>
      <div className="chat-rail-title">오늘 예약</div>
      {isLoading && <p className="chat-rail-empty">불러오는 중…</p>}
      {groups && groups.length === 0 && <p className="chat-rail-empty">예약이 없어요</p>}
      {groups?.map((group) => (
        <Card key={group.reservationRequestId ?? group.segments[0].reservationId} radius="lg" className="chat-today-card">
          <div className="chat-today-card-title">{group.title}</div>
          {group.segments.map((segment) => (
            <div className="chat-today-card-meta" key={segment.reservationId}>
              <span>{segment.roomName ?? "회의실 미상"}</span>
              <span className="mono">
                {hhmm(segment.startAt)}~{hhmm(segment.endAt)}
              </span>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function PreferredRoomsRail({ rooms, isLoading }: { rooms: Room[] | undefined; isLoading: boolean }) {
  return (
    <div>
      {/* title 속성으로 hover 툴팁 — 사이드바가 좁아 설명을 상시 노출하면 목록이 밀린다.
          도움말이 있다는 걸 알 수 있게 점선 밑줄(.chat-rail-title-help)을 준다. */}
      <div className="chat-rail-title chat-rail-title-help" title="에이전트가 선호 회의실을 우선적으로 예약 검토합니다.">
        선호 회의실
      </div>
      {isLoading && <p className="chat-rail-empty">불러오는 중…</p>}
      {rooms && rooms.length === 0 && <p className="chat-rail-empty">등록된 선호 회의실이 없어요.</p>}
      {rooms && rooms.length > 0 && (
        <ul className="chat-pref-list">
          {rooms.map((room, index) => (
            <li key={room.id}>
              <span className={`chat-rank ${index === 0 ? "chat-rank-top" : ""}`}>{index + 1}</span>
              {room.roomName}
              <span className="chat-pref-cap mono">{capacityLabel(room.capacity)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ChatRailContentProps {
  todayGroups: MyReservationGroup[] | undefined;
  todayLoading: boolean;
  preferredRooms: Room[] | undefined;
  preferredLoading: boolean;
}

/** 오른쪽 사이드바(데스크톱)와 모바일 "내 정보" 시트가 공유하는 내용 —
 * chat-screen.dc.html: 오늘 예약 → 선호 회의실 → 알아두기 배너 순서. */
function ChatRailContent({ todayGroups, todayLoading, preferredRooms, preferredLoading }: ChatRailContentProps) {
  return (
    <>
      <TodayReservationsRail groups={todayGroups} isLoading={todayLoading} />
      <PreferredRoomsRail rooms={preferredRooms} isLoading={preferredLoading} />
      <RecurringBookingRail />
      {/* 비밀번호는 자주 쓰는 기능이 아니라 맨 아래에 둔다(사용자 요청, 20260817). */}
      <PasswordSettingsRail />
      <div className="chat-info-banner">
        같은 회의실은 하루 <b>최대 2시간</b>까지만 예약할 수 있어요. 더 필요하면 다른 회의실로 이어서 잡아드려요.
      </div>
      <div className="chat-rail-credit">CJFW-AI팀</div>
    </>
  );
}

/** 비밀번호 변경 — CJ WORLD PW 재등록과 앱 로그인 비밀번호 변경 두 가지.
 * 성격이 완전히 다른 값이라(하나는 CJ 시스템 인증용, 하나는 이 앱 로그인용) 한 폼에 섞지 않고
 * 각각 따로 펼쳐서 입력받는다. */
function PasswordSettingsRail() {
  const [openForm, setOpenForm] = useState<"cj" | "app" | null>(null);

  return (
    <div>
      <div className="chat-rail-title">비밀번호</div>
      <div className="chat-pw-list">
        <button
          type="button"
          className="chat-pw-toggle"
          aria-expanded={openForm === "cj"}
          onClick={() => setOpenForm((prev) => (prev === "cj" ? null : "cj"))}
        >
          CJ WORLD PW 재등록
          <span className="chat-pw-chevron" aria-hidden="true">
            {openForm === "cj" ? "−" : "+"}
          </span>
        </button>
        {openForm === "cj" && <CjWorldPasswordForm onClose={() => setOpenForm(null)} />}

        <button
          type="button"
          className="chat-pw-toggle"
          aria-expanded={openForm === "app"}
          onClick={() => setOpenForm((prev) => (prev === "app" ? null : "app"))}
        >
          앱 로그인 비밀번호 변경
          <span className="chat-pw-chevron" aria-hidden="true">
            {openForm === "app" ? "−" : "+"}
          </span>
        </button>
        {openForm === "app" && <AppPasswordForm onClose={() => setOpenForm(null)} />}
      </div>
    </div>
  );
}

function CjWorldPasswordForm({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const mutation = useChangeCjWorldPasswordMutation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword === "" || mutation.isPending) return;
    setErrorText(null);
    mutation.mutate(
      { new_cj_world_password: newPassword },
      {
        onSuccess: () => {
          setNewPassword("");
          setIsDone(true);
        },
        onError: (error) => {
          setErrorText(
            error instanceof HttpError ? error.message : "변경 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."
          );
        },
      }
    );
  }

  // 성공 화면은 타이머로 자동으로 닫지 않는다 — CJ 검증에 수 초 걸려서 그 사이 사용자가
  // 화면에서 눈을 떼는 일이 흔한데, 잠깐 떴다 사라지면 성공했는지 알 수 없다(실사용 신고).
  if (isDone) {
    return (
      <div className="chat-pw-form">
        <p className="chat-pw-done">
          <b>새 CJ WORLD PW를 등록했어요.</b>
          <br />
          CJ 로그인까지 확인했으니 이제 예약·조회가 정상 동작합니다.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    );
  }

  return (
    <form className="chat-pw-form" onSubmit={handleSubmit}>
      <p className="chat-pw-hint">
        CJ WORLD에서 비밀번호를 바꾸셨다면 여기에도 다시 등록해야 예약이 계속 됩니다.
      </p>
      <input
        type="password"
        className="chat-pw-input"
        placeholder="새 CJ WORLD PW"
        autoComplete="current-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        disabled={mutation.isPending}
      />
      {errorText && <p className="chat-pw-error">{errorText}</p>}
      <Button type="submit" size="sm" loading={mutation.isPending} disabled={newPassword === ""}>
        {mutation.isPending ? "CJ에서 확인 중…" : "등록"}
      </Button>
      {mutation.isPending && <p className="chat-pw-hint">실제 CJ 로그인으로 확인하느라 몇 초 걸려요.</p>}
    </form>
  );
}

function AppPasswordForm({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const mutation = useChangeAppPasswordMutation();

  const canSubmit = currentPassword !== "" && newPassword !== "" && !mutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setErrorText(null);
    mutation.mutate(
      { current_app_password: currentPassword, new_app_password: newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setIsDone(true);
        },
        onError: (error) => {
          setErrorText(
            error instanceof HttpError ? error.message : "변경 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."
          );
        },
      }
    );
  }

  if (isDone) {
    return (
      <div className="chat-pw-form">
        <p className="chat-pw-done">
          <b>앱 로그인 비밀번호를 변경했어요.</b>
          <br />
          다음 로그인부터 새 비밀번호를 쓰세요. 다른 기기에 남아있던 로그인은 모두 끊겼습니다.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    );
  }

  return (
    <form className="chat-pw-form" onSubmit={handleSubmit}>
      <input
        type="password"
        className="chat-pw-input"
        placeholder="현재 비밀번호"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        disabled={mutation.isPending}
      />
      <input
        type="password"
        className="chat-pw-input"
        placeholder="새 비밀번호 (8자 이상)"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        disabled={mutation.isPending}
      />
      {errorText && <p className="chat-pw-error">{errorText}</p>}
      <Button type="submit" size="sm" loading={mutation.isPending} disabled={!canSubmit}>
        변경
      </Button>
    </form>
  );
}

// ---- 매주 반복 예약 ----
// CJ는 오늘~7일 뒤까지만 예약을 받으므로, 반복 예약은 미리 여러 건을 만들어두는 게 아니라
// "대상일 7일 전 자정 직후"에 서버가 자동으로 잡는 방식이다(백엔드 스케줄러). 자동 실행은
// 이 사무실 PC가 켜져 있고 사내망에 붙어 있을 때만 동작하므로, 그 한계를 동의 화면에서
// 솔직히 안내한다.

const RECUR_MAX_DURATION_MINUTES = 120; // 도메인 정의서 6번: 회의실 1건당 하루 최대 2시간
const RECUR_OPEN_MINUTES = 7 * 60; // 07:00
const RECUR_CLOSE_MINUTES = 19 * 60; // 19:00
const RECUR_STEP_MINUTES = 30;

function recurMinutesToHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function recurHHMMToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// 07:00 ~ 18:30(30분 단위) — 마지막 시작 시각은 18:30이어야 30분짜리 회의라도 19:00 안에 끝난다.
const RECUR_START_OPTIONS: string[] = [];
for (let mins = RECUR_OPEN_MINUTES; mins < RECUR_CLOSE_MINUTES; mins += RECUR_STEP_MINUTES) {
  RECUR_START_OPTIONS.push(recurMinutesToHHMM(mins));
}

/** 선택한 시작 시각 기준, 30분 단위 · 최대 2시간 · 19:00을 넘지 않는 종료 시각 후보. */
function recurEndOptions(startTime: string): string[] {
  const startMinutes = recurHHMMToMinutes(startTime);
  const maxEnd = Math.min(startMinutes + RECUR_MAX_DURATION_MINUTES, RECUR_CLOSE_MINUTES);
  const options: string[] = [];
  for (let mins = startMinutes + RECUR_STEP_MINUTES; mins <= maxEnd; mins += RECUR_STEP_MINUTES) {
    options.push(recurMinutesToHHMM(mins));
  }
  return options;
}

/** 사이드바 "매주 반복 예약" — PasswordSettingsRail과 같은 패턴(자체 쿼리/뮤테이션 보유,
 * 데스크톱 사이드바·모바일 시트가 이 컴포넌트 하나를 그대로 공유). */
function RecurringBookingRail() {
  // [2026-08-17 사용자 요청] 사이드바가 길어지지 않도록 섹션 전체를 기본으로 접어둔다.
  // 사용자가 "열기"를 눌렀을 때만 목록/동의 화면을 불러온다 — 접힌 동안에는 쿼리도
  // 보내지 않아(enabled) 사이드바를 여는 것만으로 불필요한 API 호출이 생기지 않는다.
  const [isSectionOpen, setIsSectionOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="chat-pw-toggle chat-recur-section-toggle"
        aria-expanded={isSectionOpen}
        onClick={() => setIsSectionOpen((prev) => !prev)}
      >
        매주 반복 예약
        <span className="chat-pw-chevron" aria-hidden="true">
          {isSectionOpen ? "−" : "+"}
        </span>
      </button>
      {isSectionOpen && <RecurringBookingPanel />}
    </div>
  );
}

/** 섹션을 펼쳤을 때만 마운트되는 본문 — 목록 + 동의 게이트 + 새 규칙 폼. */
function RecurringBookingPanel() {
  const rulesQuery = useRecurringRulesQuery();
  const consentQuery = useUnattendedConsentQuery();
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <div className="chat-recur-panel">
      {rulesQuery.isLoading && <p className="chat-rail-empty">불러오는 중…</p>}
      {rulesQuery.isError && <p className="chat-pw-error">목록을 불러오지 못했어요.</p>}
      {rulesQuery.data && rulesQuery.data.length === 0 && (
        <p className="chat-rail-empty">등록된 반복 예약이 없어요.</p>
      )}
      {rulesQuery.data && rulesQuery.data.length > 0 && (
        <ul className="chat-recur-list">
          {rulesQuery.data.map((rule) => (
            <RecurringRuleCard key={rule.id} rule={rule} />
          ))}
        </ul>
      )}

      {consentQuery.isError && <p className="chat-pw-error">동의 상태를 불러오지 못했어요.</p>}

      {!consentQuery.isLoading && consentQuery.data && !consentQuery.data.consented && (
        <UnattendedConsentGate />
      )}

      {!consentQuery.isLoading && consentQuery.data?.consented && (
        <>
          <button
            type="button"
            className="chat-pw-toggle"
            aria-expanded={isFormOpen}
            onClick={() => setIsFormOpen((prev) => !prev)}
          >
            새 반복 예약 추가
            <span className="chat-pw-chevron" aria-hidden="true">
              {isFormOpen ? "−" : "+"}
            </span>
          </button>
          {isFormOpen && <RecurringRuleForm onDone={() => setIsFormOpen(false)} />}
          <RevokeUnattendedConsentControl />
        </>
      )}
    </div>
  );
}

function recurWeekdayLine(rule: RecurringRule): string {
  return `매주 ${WEEKDAY_LABELS[rule.weekday]}요일 · ${rule.start_time}~${rule.end_time}`;
}

/** 등록된 규칙 한 건 — 회의실 우선순위, 활성 토글, 삭제, 최근 실행 결과. */
function RecurringRuleCard({ rule }: { rule: RecurringRule }) {
  const toggleMutation = useToggleRecurringRuleMutation();
  const deleteMutation = useDeleteRecurringRuleMutation();

  function handleToggle() {
    toggleMutation.mutate({ id: rule.id, is_active: !rule.is_active });
  }

  function handleDelete() {
    if (!window.confirm(`"${rule.title}" 반복 예약을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    deleteMutation.mutate(rule.id);
  }

  return (
    <li className={`chat-recur-card ${!rule.is_active ? "chat-recur-card-inactive" : ""}`}>
      <div className="chat-recur-head">
        <span className="chat-recur-when mono">{recurWeekdayLine(rule)}</span>
        <button
          type="button"
          role="switch"
          aria-checked={rule.is_active}
          aria-label={rule.is_active ? `${rule.title} 비활성화` : `${rule.title} 활성화`}
          className="chat-recur-switch"
          disabled={toggleMutation.isPending}
          onClick={handleToggle}
        >
          <span className="chat-recur-switch-knob" aria-hidden="true" />
        </button>
      </div>
      <div className="chat-recur-title">{rule.title}</div>
      <div className="chat-recur-rooms">
        {rule.rooms
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((room) => (
            <span key={room.room_id} className="chat-recur-room-chip">
              {room.priority}. {room.room_name}
            </span>
          ))}
      </div>

      {rule.latest_run && <RecurringRunResult run={rule.latest_run} />}

      <button
        type="button"
        className="chat-recur-delete"
        disabled={deleteMutation.isPending}
        onClick={handleDelete}
      >
        {deleteMutation.isPending ? "삭제하는 중…" : "삭제"}
      </button>
    </li>
  );
}

/** 최근 실행 결과 — 성공/실패/건너뜀을 시각적으로 구분한다. 실패는 기존 semantic-error 톤을 쓴다. */
function RecurringRunResult({ run }: { run: RecurringRuleLatestRun }) {
  const dateLabel = formatDateWithWeekday(run.target_date);

  if (run.status === "succeeded") {
    return (
      <span className="chat-status-line chat-recur-run">
        <span className="chat-status-dot-inline" aria-hidden="true" />
        {dateLabel} · {run.booked_room_name ?? "회의실 미상"}으로 예약 완료
      </span>
    );
  }

  if (run.status === "failed") {
    return (
      <p className="chat-recur-run chat-recur-run-failed">
        {dateLabel} 예약 실패 — {run.failure_reason ?? "사유를 확인할 수 없어요."}
      </p>
    );
  }

  return <p className="chat-recur-run chat-recur-run-skipped">{dateLabel} 실행 건너뜀</p>;
}

/** 동의 게이트 — 에이전트 자동 실행에 동의해야 새 규칙 폼이 열린다. */
function UnattendedConsentGate() {
  const [checked, setChecked] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const mutation = useGiveUnattendedConsentMutation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checked || mutation.isPending) return;
    setErrorText(null);
    mutation.mutate(undefined, {
      onError: (error) => {
        setErrorText(
          error instanceof HttpError ? error.message : "동의 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."
        );
      },
    });
  }

  return (
    <form className="chat-pw-form" onSubmit={handleSubmit}>
      <p className="chat-pw-hint">
        반복 예약을 사용하려면 '에이전트 자동 실행'에 동의해야 해요.{" "}
        <b className="chat-recur-notice">
          대상 일자 7일 전에 에이전트가 사용자님의 CJ WORLD 계정으로 로그인해 대신 예약을 합니다.
        </b>{" "}
        <b className="chat-recur-notice">
          회의실 예약 챗봇 서버가 가동중이 아닌 경우 반복 예약은 실행되지 않을 수 있으니 최종 사용자가 직접 확인을
          권장드립니다.
        </b>
      </p>
      <label className="chat-recur-consent-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          disabled={mutation.isPending}
        />
        위 내용을 이해했고 동의합니다
      </label>
      {errorText && <p className="chat-pw-error">{errorText}</p>}
      <Button type="submit" size="sm" loading={mutation.isPending} disabled={!checked}>
        동의하고 시작하기
      </Button>
    </form>
  );
}

/** 동의 철회 — 철회하면 서버가 모든 규칙을 비활성화한다는 점을 미리 안내한다. */
function RevokeUnattendedConsentControl() {
  const mutation = useRevokeUnattendedConsentMutation();

  function handleRevoke() {
    if (!window.confirm("에이전트 자동 실행 동의를 철회할까요? 등록된 모든 반복 예약이 비활성화됩니다.")) return;
    mutation.mutate();
  }

  return (
    <button type="button" className="chat-recur-revoke" disabled={mutation.isPending} onClick={handleRevoke}>
      {mutation.isPending ? "철회하는 중…" : "에이전트 자동 실행 동의 철회"}
    </button>
  );
}

/** 새 규칙 폼 — 요일/시간/회의명/반복 대상 회의실(최대 3곳, 층별로 접히는 RecurringRoomPicker). */
function RecurringRuleForm({ onDone }: { onDone: () => void }) {
  const roomsQuery = useRoomsQuery();
  const createMutation = useCreateRecurringRuleMutation();

  const [weekday, setWeekday] = useState(1); // 기본값: 월요일
  const [startTime, setStartTime] = useState(RECUR_START_OPTIONS[0]);
  const endOptions = useMemo(() => recurEndOptions(startTime), [startTime]);
  const [endTime, setEndTime] = useState(endOptions[0]);
  const [title, setTitle] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  // 시작 시간이 바뀌면 종료 시간 후보 목록도 바뀐다 — 현재 선택값이 새 목록 밖으로
  // 밀려났으면(예: 종료를 뒤로 미뤄뒀다가 시작을 늦춘 경우) 첫 후보로 맞춰준다.
  useEffect(() => {
    setEndTime((prev) => (endOptions.includes(prev) ? prev : endOptions[0]));
  }, [endOptions]);

  const canSubmit = title.trim() !== "" && roomIds.length > 0 && !createMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setErrorText(null);
    createMutation.mutate(
      { weekday, start_time: startTime, end_time: endTime, title: title.trim(), room_ids: roomIds },
      {
        onSuccess: () => onDone(),
        onError: (error) => {
          setErrorText(
            error instanceof HttpError ? error.message : "등록 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."
          );
        },
      }
    );
  }

  return (
    <form className="chat-pw-form chat-recur-form" onSubmit={handleSubmit}>
      <p className="chat-pw-hint">30분 단위 · 07:00~19:00 · 회의실 1건당 최대 2시간까지 설정할 수 있어요.</p>

      <label className="chat-recur-field">
        <span className="chat-recur-field-label">요일</span>
        <select
          className="chat-recur-select"
          value={weekday}
          onChange={(event) => setWeekday(Number(event.target.value))}
          disabled={createMutation.isPending}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index}>
              매주 {label}요일
            </option>
          ))}
        </select>
      </label>

      <div className="chat-recur-time-row">
        <label className="chat-recur-field">
          <span className="chat-recur-field-label">시작</span>
          <select
            className="chat-recur-select mono"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            disabled={createMutation.isPending}
          >
            {RECUR_START_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label className="chat-recur-field">
          <span className="chat-recur-field-label">종료</span>
          <select
            className="chat-recur-select mono"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            disabled={createMutation.isPending}
          >
            {endOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="chat-recur-field">
        <span className="chat-recur-field-label">회의명</span>
        <input
          type="text"
          className="chat-pw-input"
          placeholder="예: 주간 스크럼"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={createMutation.isPending}
        />
      </label>

      <RecurringRoomPicker
        rooms={roomsQuery.data ?? []}
        isLoading={roomsQuery.isLoading}
        loadError={roomsQuery.isError}
        value={roomIds}
        onChange={setRoomIds}
      />

      {errorText && <p className="chat-pw-error">{errorText}</p>}

      <div className="chat-card-actions">
        <Button type="submit" size="sm" loading={createMutation.isPending} disabled={!canSubmit}>
          등록
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          취소
        </Button>
      </div>
    </form>
  );
}

/** 반복 예약이 시도할 회의실을 1~3순위로 고르는 UI.
 *
 * [2026-08-17 사용자 요청 — 회원가입의 PreferredRoomPicker를 쓰지 않는 이유]
 *  1. 여기서 고르는 건 "선호 회의실"(사용자 전역 취향)이 아니라 **이 규칙이 실제로 예약을
 *     시도할 대상 회의실**이다. 이름이 같으면 두 개념을 혼동하게 된다.
 *  2. 회의실이 26개라 평면 칩 목록으로 깔면 좁은 사이드바가 통째로 밀린다. 그래서 층별로
 *     묶어 기본은 접어두고, 누른 층만 펼친다(기존 groupRoomsByFloor 재사용).
 * 회원가입 화면은 기존 PreferredRoomPicker를 그대로 쓴다 — 그쪽은 넓은 단일 컬럼 폼이라
 * 평면 목록이 오히려 낫고, 개념도 실제로 "선호 회의실"이 맞다.
 */
const RECUR_MAX_ROOM_COUNT = 3;

function RecurringRoomPicker({
  rooms,
  isLoading,
  loadError,
  value,
  onChange,
}: {
  rooms: Room[];
  isLoading: boolean;
  loadError: boolean;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const floorGroups = useMemo(() => groupRoomsByFloor(rooms), [rooms]);
  const [openFloor, setOpenFloor] = useState<string | null>(null);
  const selectedRooms = value
    .map((id) => rooms.find((room) => room.id === id))
    .filter((room): room is Room => room != null);

  function toggleRoom(roomId: string) {
    if (value.includes(roomId)) {
      onChange(value.filter((id) => id !== roomId));
      return;
    }
    if (value.length >= RECUR_MAX_ROOM_COUNT) return;
    onChange([...value, roomId]);
  }

  return (
    <div className="chat-recur-rooms">
      <span className="chat-recur-field-label">반복 대상 회의실</span>
      <p className="chat-recur-rooms-hint">
        누른 순서가 시도 순서예요. 1순위가 차 있으면 2·3순위를 차례로 잡습니다. (최대{" "}
        {RECUR_MAX_ROOM_COUNT}곳)
      </p>

      {isLoading && <p className="chat-rail-empty">회의실 목록을 불러오는 중…</p>}
      {loadError && <p className="chat-pw-error">회의실 목록을 불러오지 못했어요.</p>}

      {selectedRooms.length > 0 && (
        <ol className="chat-recur-picked">
          {selectedRooms.map((room, index) => (
            <li key={room.id} className="chat-recur-picked-item">
              <span className="chat-recur-picked-rank">{index + 1}순위</span>
              <span className="chat-recur-picked-name">{room.roomName}</span>
              <button
                type="button"
                className="chat-recur-picked-remove"
                onClick={() => toggleRoom(room.id)}
                aria-label={`${room.roomName} 선택 해제`}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      {floorGroups.map((group) => {
        const isOpen = openFloor === group.floorLabel;
        const pickedInFloor = group.rooms.filter((room) => value.includes(room.id)).length;
        return (
          <div key={group.floorLabel} className="chat-recur-floor">
            <button
              type="button"
              className="chat-recur-floor-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpenFloor((prev) => (prev === group.floorLabel ? null : group.floorLabel))}
            >
              <span>
                {group.floorLabel}
                <span className="chat-recur-floor-count">
                  {pickedInFloor > 0 ? ` · ${pickedInFloor}곳 선택` : ` · ${group.rooms.length}개`}
                </span>
              </span>
              <span className="chat-pw-chevron" aria-hidden="true">
                {isOpen ? "−" : "+"}
              </span>
            </button>
            {isOpen && (
              <div className="chat-chip-group chat-recur-floor-rooms">
                {group.rooms.map((room) => {
                  const selected = value.includes(room.id);
                  const atLimit = !selected && value.length >= RECUR_MAX_ROOM_COUNT;
                  return (
                    <Chip
                      key={room.id}
                      selected={selected}
                      disabled={atLimit}
                      onClick={() => toggleRoom(room.id)}
                    >
                      {room.roomName} · {capacityLabel(room.capacity)}
                    </Chip>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ChatPanelSheetProps extends ChatRailContentProps {
  onClose: () => void;
  isAdmin: boolean;
  onLogout: () => void;
  logoutPending: boolean;
}

/** chat-screen.dc.html "모바일 바텀시트" — 860px 이하에서 우측 패널 대신 쓰는 진입점.
 * 스크림 클릭/Esc로 닫히고, 열려있는 동안 배경 스크롤을 잠근다. */
function ChatPanelSheet({
  onClose,
  isAdmin,
  onLogout,
  logoutPending,
  ...railProps
}: ChatPanelSheetProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="chat-sheet-root">
      <div className="chat-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="chat-sheet" role="dialog" aria-modal="true" aria-label="내 정보">
        <div className="chat-sheet-handle" aria-hidden="true" />
        <div className="chat-sheet-body">
          <ChatRailContent {...railProps} />
          <div className="chat-sheet-actions">
            {isAdmin && (
              <Link to="/admin" className="btn btn-ghost chat-sheet-action-btn">
                <span className="btn-label">Admin 패널</span>
              </Link>
            )}
            <Button variant="ghost" className="chat-sheet-action-btn" onClick={onLogout} loading={logoutPending}>
              로그아웃
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
