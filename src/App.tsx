import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import AdminDashboard from "@/pages/AdminDashboard";
import EmployeeDashboard from "@/pages/EmployeeDashboard";
import TasksPage from "@/pages/TasksPage";
import UsersPage from "@/pages/UsersPage";
import AdminLeavePage from "@/pages/AdminLeavePage";
import EmployeeLeavePage from "@/pages/EmployeeLeavePage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import ProfilePage from "@/pages/ProfilePage";
import CalendarPage from "@/pages/CalendarPage";
import TeamsPage from "@/pages/TeamsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function RootRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile) return <Navigate to="/login" replace />;
  return profile.role === "employee" ? <Navigate to="/my-dashboard" replace /> : <Navigate to="/dashboard" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="bottom-right" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<RootRedirect />} />

            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><AdminDashboard /></ProtectedRoute>} />
              <Route path="/tasks" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><TasksPage /></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute allowedRoles={["admin"]}><UsersPage /></ProtectedRoute>} />
              <Route path="/team" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><Navigate to="/users" replace /></ProtectedRoute>} />
              <Route path="/leave" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><AdminLeavePage /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><ReportsPage /></ProtectedRoute>} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/teams" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><TeamsPage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><SettingsPage /></ProtectedRoute>} />
              <Route path="/my-dashboard" element={<ProtectedRoute allowedRoles={["employee"]}><EmployeeDashboard /></ProtectedRoute>} />
              <Route path="/my-tasks" element={<ProtectedRoute allowedRoles={["employee"]}><TasksPage /></ProtectedRoute>} />
              <Route path="/my-teams" element={<ProtectedRoute allowedRoles={["employee"]}><TeamsPage /></ProtectedRoute>} />
              <Route path="/my-leave" element={<ProtectedRoute allowedRoles={["employee", "manager"]}><EmployeeLeavePage /></ProtectedRoute>} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
