// FE-5에서 구현. FE-1은 라우팅 스캐폴딩만 담당한다 (prompts/9-plan.md).
// 실제 셸 레이아웃/스타일 레퍼런스: docs/design/chatbot-shell.html
export function ChatPage() {
  return (
    <main style={{ padding: "var(--space-xl)" }}>
      <h1 style={{ fontSize: "var(--fs-headline)", fontWeight: "var(--fw-headline)" }}>
        회의실 예약 챗봇
      </h1>
      <p style={{ color: "var(--ink-muted)" }}>FE-5에서 구현 예정.</p>
    </main>
  );
}
