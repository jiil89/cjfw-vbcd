import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./ChatPage.css";
import { Badge, Button, Card, CardButton, Chip } from "../../components";
import { HttpError } from "../../api/httpClient";
import { useAuthStore } from "../../stores/authStore";
import { useLogoutMutation } from "../../queries/authQueries";
import {
  usePreferredRoomsQuery,
  useSendChatMessageMutation,
  useTodayReservationsQuery,
} from "../../queries/chatQueries";
import type {
  CheckAvailabilityData,
  ChatProposal,
  ConfirmedResultData,
  GenericProposalData,
  MyReservationGroup,
  ProposeCreateReservationData,
  ProposeSplitReservationData,
} from "../../types/chat";
import type { Room } from "../../types/room";

interface ChatUiMessage {
  id: string;
  role: "agent" | "user";
  text: string;
  timestamp: Date;
  proposal?: ChatProposal | null;
  pending?: boolean;
  isError?: boolean;
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

/** "2026-08-14T14:00:00.000Z" -> "14:00" (사용자 로컬 표시가 아니라 예약 자체의 벽시계 시각을 그대로 보여준다). */
function hhmm(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match ? match[1] : iso;
}

function capacityLabel(capacity: number | null): string {
  return capacity === null ? "인원 미상" : `${capacity}인`;
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
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId ? { id: pendingId, role: "agent", text: message, timestamp: new Date(), isError: true } : m
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

  return (
    <div className="chat-page">
      <header className="chat-topbar">
        <div className="chat-brand">
          <span className="chat-brand-mark">회</span>
          <span className="chat-brand-name">회의실 예약</span>
          <span className="chat-brand-site mono">상암S시티</span>
        </div>
        <div className="chat-header-actions">
          <div className="chat-user-chip">
            <span className="chat-status-dot" aria-hidden="true" />
            <span className="chat-avatar">{avatarInitial}</span>
            <span className="chat-user-name">{user?.email_alias}</span>
          </div>
          {user?.is_admin && (
            <Link to="/admin" className="btn btn-ghost btn-sm">
              <span className="btn-label">Admin 패널</span>
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout} loading={logoutMutation.isPending}>
            로그아웃
          </Button>
        </div>
      </header>

      <div className="chat-body">
        <section className="chat-col">
          <div className="chat-thread" ref={threadRef}>
            <div className="chat-day-divider">{formatDayDivider(new Date())}</div>

            {messages.map((message) => (
              <ChatMessageRow key={message.id} message={message} onAction={sendMessage} userAvatarInitial={avatarInitial} />
            ))}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <div className="chat-quick-chips">
              {QUICK_COMMANDS.map((command) => (
                <Chip
                  key={command.label}
                  type="button"
                  disabled={sendMutation.isPending}
                  onClick={() => sendMessage(command.message)}
                >
                  {command.label}
                </Chip>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                type="text"
                className="chat-input"
                placeholder="메시지를 입력하세요 (예: 내일 오전 10시 회의실 잡아줘)"
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22 11 13 2 9z" />
                </svg>
              </button>
            </div>
          </form>
        </section>

        <aside className="chat-rail">
          <TodayReservationsRail groups={todayQuery.data} isLoading={todayQuery.isLoading} />
          <PreferredRoomsRail rooms={prefQuery.data} isLoading={prefQuery.isLoading} />
          <div className="chat-rule-note">
            같은 회의실은 하루 <b>최대 2시간</b>까지만 예약할 수 있어요. 더 필요하면 다른 회의실로 이어서 잡아드려요.
          </div>
        </aside>
      </div>
    </div>
  );
}

function ChatMessageRow({
  message,
  onAction,
  userAvatarInitial,
}: {
  message: ChatUiMessage;
  onAction: (text: string) => void;
  userAvatarInitial: string;
}) {
  const isAgent = message.role === "agent";
  return (
    <div className={`chat-row ${isAgent ? "chat-row-agent" : "chat-row-user"}`}>
      <span className="chat-avatar" aria-hidden="true">
        {isAgent ? "A" : userAvatarInitial}
      </span>
      <div className="chat-bubble-stack">
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
        {!message.pending && message.proposal && <ProposalCard proposal={message.proposal} onAction={onAction} />}
        <span className="chat-timestamp">{formatTimestamp(message.timestamp)}</span>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, onAction }: { proposal: ChatProposal; onAction: (text: string) => void }): ReactNode {
  switch (proposal.tool) {
    case "check_availability": {
      const data = proposal.data as CheckAvailabilityData;
      const rooms = [...data.preferred, ...data.others];
      if (rooms.length === 0) return null;
      const preferredIds = new Set(data.preferred.map((room) => room.id));
      return (
        <div className="chat-room-grid">
          {rooms.map((room) => (
            <CardButton
              key={room.id}
              radius="lg"
              className="chat-room-pick"
              onClick={() => onAction(`${room.roomName}으로 할래요`)}
            >
              <span className="chat-room-pick-name">{room.roomName}</span>
              <span className="chat-room-pick-tags">
                <Badge tone="success">{capacityLabel(room.capacity)}</Badge>
                {preferredIds.has(room.id) && <Badge tone="neutral">선호</Badge>}
              </span>
            </CardButton>
          ))}
        </div>
      );
    }

    case "propose_create_reservation": {
      const data = proposal.data as ProposeCreateReservationData;
      return (
        <Card radius="xl" className="chat-room-card">
          <div className="chat-room-card-head">
            <span className="chat-room-card-name">{data.room.roomName}</span>
            <span className="chat-room-card-time mono">
              {data.startTime}~{data.endTime}
            </span>
          </div>
          <div className="chat-room-card-tags">
            <Badge tone="success">예약가능</Badge>
            <Badge tone="neutral">{capacityLabel(data.room.capacity)}</Badge>
          </div>
          <div className="chat-card-actions">
            <Button size="sm" onClick={() => onAction("네, 이 회의실로 확정해주세요")}>
              이 회의실로 확정
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("다른 회의실도 보여줘")}>
              다른 곳 보기
            </Button>
          </div>
        </Card>
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
      return (
        <Card radius="xl" className="chat-room-card">
          <p className="chat-generic-summary">{data.summary}</p>
          <div className="chat-card-actions">
            <Button size="sm" onClick={() => onAction("네, 진행해주세요")}>
              확정
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction("아니요, 하지 마세요")}>
              그만둘게요
            </Button>
          </div>
        </Card>
      );
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

function TodayReservationsRail({ groups, isLoading }: { groups: MyReservationGroup[] | undefined; isLoading: boolean }) {
  return (
    <div>
      <div className="chat-rail-title">오늘 예약</div>
      {isLoading && <p className="chat-rail-empty">불러오는 중…</p>}
      {groups && groups.length === 0 && <p className="chat-rail-empty">오늘 예약이 없어요.</p>}
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
      <div className="chat-rail-title">선호 회의실</div>
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
