import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RegisterPage } from "../pages/register/RegisterPage";
import { LoginPage } from "../pages/login/LoginPage";
import { AdminPanelPage } from "../pages/admin/AdminPanelPage";
import { ChatPage } from "../pages/chat/ChatPage";
import { RequireAdmin } from "./RequireAdmin";

// 로그인 필요 라우트 가드는 FE-5(챗봇 UI 구현 시)에서 추가한다. FE-4는 Admin
// 전용 가드(RequireAdmin)만 우선 구현한다(prompts/9-plan.md FE-4 완료조건).
const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/admin",
    element: (
      <RequireAdmin>
        <AdminPanelPage />
      </RequireAdmin>
    ),
  },
  { path: "/chat", element: <ChatPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
