import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./AdminPanelPage.css";
import { Badge, Button, Card } from "../../components";
import { useAuthStore } from "../../stores/authStore";
import { useLogoutMutation } from "../../queries/authQueries";
import { useRoomsQuery } from "../../queries/registrationQueries";
import {
  useApproveRequestMutation,
  usePendingRequestsQuery,
  useProcessedRequestsQuery,
  useRejectRequestMutation,
} from "../../queries/adminQueries";
import type { AccountRegistrationRequest } from "../../types/admin";
import type { Room } from "../../types/room";

/** "2026-08-13T09:10:00.000Z" -> "08/13 09:10" (7-wireframes.md 3번 표기 그대로). */
function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function formatPreferredRooms(roomIds: string[], roomsById: Map<string, Room>): string {
  if (roomIds.length === 0) return "(미입력)";
  return roomIds
    .map((id, index) => `${index + 1}순위 ${roomsById.get(id)?.roomName ?? "(알 수 없음)"}`)
    .join(", ");
}

/**
 * Admin 승인 패널 — `7-wireframes.md` 3번. 대기중 등록 요청(승인/거부) + 처리 완료 이력.
 * 비밀번호/암호문은 백엔드 응답 자체에 포함되지 않으므로(admin.routes.ts), 여기서도
 * 이름을 명시한 필드만 렌더링해 우발적 노출을 구조적으로 막는다.
 */
export function AdminPanelPage() {
  const navigate = useNavigate();
  const adminUser = useAuthStore((state) => state.user);
  const logoutMutation = useLogoutMutation();

  const pendingQuery = usePendingRequestsQuery();
  const processedQuery = useProcessedRequestsQuery();
  const roomsQuery = useRoomsQuery();
  const approveMutation = useApproveRequestMutation();
  const rejectMutation = useRejectRequestMutation();

  const roomsById = new Map((roomsQuery.data ?? []).map((room) => [room.id, room]));

  function handleLogout() {
    logoutMutation.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  }

  function handleApprove(request: AccountRegistrationRequest) {
    if (!window.confirm(`${request.email_alias} 신청을 승인할까요?`)) return;
    approveMutation.mutate(request.id);
  }

  function handleReject(request: AccountRegistrationRequest) {
    if (!window.confirm(`${request.email_alias} 신청을 거부할까요? 되돌릴 수 없습니다.`)) return;
    rejectMutation.mutate(request.id);
  }

  const historyContent = renderHistory(processedQuery.data, processedQuery.isLoading);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <h1 className="admin-title">회의실 예약 — Admin 패널</h1>
        <div className="admin-header-actions">
          {adminUser && <span className="admin-identity">{adminUser.email_alias}</span>}
          {/* Admin도 챗봇 UI에 접근할 수 있어야 하는데, 세션이 메모리(Zustand)에만 있어
              풀 페이지 이동(주소창 직접 입력)은 세션을 지워버린다 — 반드시 클라이언트
              사이드 라우팅(react-router Link)으로 이동해야 세션이 유지된다. */}
          <Link to="/chat" className="btn btn-ghost btn-sm">
            <span className="btn-label">챗봇으로 이동</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={handleLogout} loading={logoutMutation.isPending}>
            로그아웃
          </Button>
        </div>
      </header>

      <section className="admin-section">
        <h2 className="admin-section-title">대기중인 등록 요청</h2>

        {pendingQuery.isLoading && <p className="admin-empty-note">불러오는 중…</p>}
        {pendingQuery.isError && <p className="admin-empty-note admin-error-note">목록을 불러오지 못했습니다.</p>}
        {pendingQuery.data && pendingQuery.data.length === 0 && (
          <p className="admin-empty-note">대기중인 등록 요청이 없습니다.</p>
        )}

        <div className="admin-request-list">
          {pendingQuery.data?.map((request) => {
            const isApproving = approveMutation.isPending && approveMutation.variables === request.id;
            const isRejecting = rejectMutation.isPending && rejectMutation.variables === request.id;
            return (
              <Card key={request.id} radius="lg" className="admin-request-card">
                <div className="admin-request-row">
                  <span className="admin-request-label">CJ WORLD ID:</span>
                  <span className="admin-request-value">{request.email_alias}</span>
                  <span className="admin-request-meta">신청일시: {formatShortDateTime(request.created_at)}</span>
                </div>
                <div className="admin-request-row">
                  <span className="admin-request-label">선호 회의실:</span>
                  <span className="admin-request-value">{formatPreferredRooms(request.preferred_room_ids, roomsById)}</span>
                </div>
                <div className="admin-request-row">
                  <span className="admin-request-label">상태:</span>
                  <Badge tone="neutral">대기(Pending)</Badge>
                </div>
                <div className="admin-request-actions">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(request)}
                    loading={isApproving}
                    disabled={isRejecting}
                  >
                    승인
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReject(request)}
                    loading={isRejecting}
                    disabled={isApproving}
                  >
                    거부
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 데스크톱: 항상 펼침. 아래 <details>(모바일용)와 서로 배타적으로 CSS가 숨긴다. */}
      <section className="admin-section admin-history-desktop">
        <h2 className="admin-section-title">처리 완료 이력</h2>
        {historyContent}
      </section>

      {/* 모바일(≤860px): 기본 접힘, <summary> 클릭으로 펼침. */}
      <details className="admin-history-mobile">
        <summary className="admin-section-title">처리 완료 이력</summary>
        {historyContent}
      </details>
    </main>
  );
}

function renderHistory(
  requests: AccountRegistrationRequest[] | undefined,
  isLoading: boolean
): ReactNode {
  if (isLoading) return <p className="admin-empty-note">불러오는 중…</p>;
  if (!requests || requests.length === 0) return <p className="admin-empty-note">처리 이력이 없습니다.</p>;

  return (
    <ul className="admin-history-list">
      {requests.map((request) => (
        <li key={request.id} className="admin-history-item">
          · {request.email_alias} — {request.status === "rejected" ? "거부" : "승인"} — 처리자:{" "}
          {request.processed_by_email_alias ?? "system(자동승인)"}
        </li>
      ))}
    </ul>
  );
}
