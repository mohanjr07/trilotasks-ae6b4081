import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes, Navigate } from "react-router-dom";

// When running inside the Electron desktop build, the app is loaded over
// file:// — BrowserRouter can't handle deep links / reloads on that origin,
// so we transparently switch to HashRouter. preload.cjs sets window.IS_ELECTRON.
const Router =
  typeof window !== "undefined" && (window as any).IS_ELECTRON
    ? HashRouter
    : BrowserRouter;
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
import TeamMembersPage from "@/pages/TeamMembersPage";
import NotesPage from "@/pages/NotesPage";
import InternDashboard from "@/pages/InternDashboard";
import ProjectsPage from "@/pages/ProjectsPage";
import OrganisationFlowPage from "@/pages/OrganisationFlowPage";
import AssetsPage from "@/pages/AssetsPage";
import PeoplePage from "@/pages/PeoplePage";
import KraKpiPage from "@/pages/KraKpiPage";
import DocumentsPage from "@/pages/DocumentsPage";
import CompletedTasksPage from "@/pages/CompletedTasksPage";
import BirthdaysPage from "@/pages/BirthdaysPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const TriloEmblem = () => (
  <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" width="72" height="72" aria-label="Trilo">
    <defs>
      <linearGradient id="triloGradApp" x1="0%" y1="0%" x2="60%" y2="100%">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="45%" stopColor="#818cf8" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <path d="M100 95 L30 30 Q18 18 28 10 Q38 2 48 14 L108 78" fill="none" stroke="url(#triloGradApp)" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M100 95 L170 30 Q182 18 172 10 Q162 2 152 14 L92 78" fill="none" stroke="url(#triloGradApp)" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M100 95 L100 200" fill="none" stroke="url(#triloGradApp)" strokeWidth="18" strokeLinecap="round" />
  </svg>
);

function RootRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center">
          <span
            className="absolute rounded-full border-2 border-t-transparent animate-spin"
            style={{ width: 120, height: 120, borderColor: "#818cf8 transparent transparent transparent" }}
          />
          <span
            className="absolute rounded-full animate-ping"
            style={{ width: 100, height: 100, border: "1px solid #818cf840", animationDuration: "1.5s" }}
          />
        </div>
        <p className="text-sm text-muted-foreground tracking-widest uppercase animate-pulse select-none">
          Loading…
        </p>
      </div>
    </div>
  );
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role === "employee") return <Navigate to="/my-dashboard" replace />;
  if (profile.role === "intern") return <Navigate to="/intern-dashboard" replace />;
  return <Navigate to="/dashboard" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="bottom-right" />
      <Router>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<RootRedirect />} />

            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><AdminDashboard /></ProtectedRoute>} />
              <Route path="/tasks" element={<ProtectedRoute allowedRoles={["admin", "manager", "employee"]}><TasksPage /></ProtectedRoute>} />
              <Route path="/completed-tasks" element={<CompletedTasksPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              {/* Organisation Flow — visible to every signed-in role.
                  Admin-only writes are enforced at the DB level via RLS. */}
              <Route path="/organisation-flow" element={<OrganisationFlowPage />} />
              {/* Assets — admins see/edit everything; everyone else sees only their own assets (read-only). */}
              <Route path="/assets" element={<AssetsPage />} />
              <Route path="/people" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><PeoplePage /></ProtectedRoute>} />
              {/* KRA & KPI — every signed-in role can access; UI scopes write access. */}
              <Route path="/kra-kpi" element={<KraKpiPage />} />
              {/* Documents — every signed-in role can access; users see only their own. */}
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/users" element={<ProtectedRoute allowedRoles={["admin"]}><UsersPage /></ProtectedRoute>} />
              <Route path="/team" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><Navigate to="/users" replace /></ProtectedRoute>} />
              <Route path="/leave" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><AdminLeavePage /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><ReportsPage /></ProtectedRoute>} />
              <Route path="/calendar" element={<CalendarPage />} />
              {/* Team Members — replaces the old Microsoft-Teams-style /teams page.
                  Visible to everyone signed in. Admin assigns; manager sees own team;
                  employees & interns see their manager + teammates. */}
              <Route path="/team-members" element={<TeamMembersPage />} />
              {/* Legacy redirects so existing /teams and /my-teams links don't 404 */}
              <Route path="/teams" element={<Navigate to="/team-members" replace />} />
              <Route path="/settings" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><SettingsPage /></ProtectedRoute>} />
              <Route path="/my-dashboard" element={<ProtectedRoute allowedRoles={["employee"]}><EmployeeDashboard /></ProtectedRoute>} />
              <Route path="/my-tasks" element={<ProtectedRoute allowedRoles={["employee", "manager"]}><TasksPage myTasksOnly /></ProtectedRoute>} />
              <Route path="/my-teams" element={<Navigate to="/team-members" replace />} />
              <Route path="/my-leave" element={<ProtectedRoute allowedRoles={["employee", "manager"]}><EmployeeLeavePage /></ProtectedRoute>} />
              <Route path="/intern-dashboard" element={<ProtectedRoute allowedRoles={["intern"]}><InternDashboard /></ProtectedRoute>} />
              <Route path="/intern-tasks" element={<ProtectedRoute allowedRoles={["intern"]}><TasksPage myTasksOnly /></ProtectedRoute>} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/birthdays" element={<BirthdaysPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
