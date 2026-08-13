import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RegisterPage } from "../pages/register/RegisterPage";
import { LoginPage } from "../pages/login/LoginPage";
import { AdminPanelPage } from "../pages/admin/AdminPanelPage";
import { ChatPage } from "../pages/chat/ChatPage";

// 인증 가드(로그인 필요 라우트, Admin 전용 라우트)는 FE-3/FE-4에서 authStore와 함께
// 구현한다. FE-1은 4개 화면과 1:1 대응하는 라우트 골격만 둔다.
const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/admin", element: <AdminPanelPage /> },
  { path: "/chat", element: <ChatPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
