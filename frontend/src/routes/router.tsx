import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RegisterPage } from "../pages/register/RegisterPage";
import { LoginPage } from "../pages/login/LoginPage";
import { AdminPanelPage } from "../pages/admin/AdminPanelPage";
import { ChatPage } from "../pages/chat/ChatPage";
import { RequireAdmin } from "./RequireAdmin";
import { RequireAuth } from "./RequireAuth";

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
  {
    path: "/chat",
    element: (
      <RequireAuth>
        <ChatPage />
      </RequireAuth>
    ),
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
