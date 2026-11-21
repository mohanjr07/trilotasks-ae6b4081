// ─────────────────────────────────────────────────────────────────────────────
//  Makes pages open instantly: every page's code is downloaded quietly in the
//  background after the app has loaded, and a page is fetched straight away
//  when a finger/mouse touches its menu link. (Same import paths as App.tsx,
//  so the browser loads each page file only once.)
// ─────────────────────────────────────────────────────────────────────────────
const PAGES: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/AdminDashboard"),
  "/my-dashboard": () => import("@/pages/EmployeeDashboard"),
  "/intern-dashboard": () => import("@/pages/InternDashboard"),
  "/tasks": () => import("@/pages/TasksPage"),
  "/my-tasks": () => import("@/pages/TasksPage"),
  "/intern-tasks": () => import("@/pages/TasksPage"),
  "/completed-tasks": () => import("@/pages/CompletedTasksPage"),
  "/projects": () => import("@/pages/ProjectsPage"),
  "/payments": () => import("@/pages/PaymentsPage"),
  "/leave": () => import("@/pages/AdminLeavePage"),
  "/my-leave": () => import("@/pages/EmployeeLeavePage"),
  "/notifications": () => import("@/pages/NotificationsPage"),
  "/profile": () => import("@/pages/ProfilePage"),
  "/calendar": () => import("@/pages/CalendarPage"),
  "/form-requests": () => import("@/pages/FormRequestsPage"),
  "/production-forms": () => import("@/pages/ProductionFormsPage"),
  "/production-plan": () => import("@/pages/ProductionPlanPage"),
  "/project-forms": () => import("@/pages/ProjectFormsPage"),
  "/overtime": () => import("@/pages/OvertimePage"),
  "/payslips": () => import("@/pages/PayslipsPage"),
  "/assets": () => import("@/pages/AssetsPage"),
  "/people": () => import("@/pages/PeoplePage"),
  "/kra-kpi": () => import("@/pages/KraKpiPage"),
  "/documents": () => import("@/pages/DocumentsPage"),
  "/users": () => import("@/pages/UsersPage"),
  "/team-members": () => import("@/pages/TeamMembersPage"),
  "/teams": () => import("@/pages/TeamsPage"),
  "/my-teams": () => import("@/pages/TeamsPage"),
  "/notes": () => import("@/pages/NotesPage"),
  "/organisation-flow": () => import("@/pages/OrganisationFlowPage"),
  "/attendance": () => import("@/pages/AttendancePage"),
  "/announcements": () => import("@/pages/AnnouncementsPage"),
  "/birthdays": () => import("@/pages/BirthdaysPage"),
  "/reports": () => import("@/pages/ReportsPage"),
  "/settings": () => import("@/pages/SettingsPage"),
};

const started = new Set<string>();

/** Fetch one page's code now (e.g. when its link is touched). */
export function preloadRoute(path: string) {
  const key = Object.keys(PAGES).find((p) => path === p || path.startsWith(p + "/"));
  if (!key || started.has(key)) return;
  started.add(key);
  PAGES[key]().catch(() => started.delete(key));
}

/** Quietly fetch the given pages (the bottom-bar tabs), one at a time while the app is idle. */
export function preloadAllRoutes(first: string[] = []) {
  const conn = (navigator as any).connection;
  if (conn?.saveData) return;                                   // respect "data saver"
  // only the bottom-bar pages; the rest load the moment their menu link is touched
  const queue = [...first];
  const idle = (cb: () => void) =>
    (window as any).requestIdleCallback ? (window as any).requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 200);
  const next = () => {
    const p = queue.shift();
    if (!p) return;
    preloadRoute(p);
    idle(next);
  };
  setTimeout(() => idle(next), 2500);                            // let the first screen finish first
}
