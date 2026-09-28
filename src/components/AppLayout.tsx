import { useState, useEffect } from "react";
import { initPush } from "@/lib/push";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import InstallAppBanner from "@/components/InstallAppBanner";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, CheckSquare, Users, Calendar, BarChart3,
  Settings, User, Bell, LogOut, Menu, X, Video, StickyNote, ClipboardList, FolderKanban, Network,
  FileStack, Cake, Package, CheckCircle2, Folder, Target, Contact, Workflow, Wallet, Fingerprint,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
type NavItem = { label: string; path: string; icon: typeof LayoutDashboard };
const adminNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", path: "/tasks", icon: CheckSquare },
  { label: "Completed Tasks", path: "/completed-tasks", icon: CheckCircle2 },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "Users", path: "/users", icon: Users },
  { label: "Team Members", path: "/team-members", icon: Workflow },
  { label: "Teams", path: "/teams", icon: Video },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "Attendance", path: "/attendance", icon: Fingerprint },
  { label: "All Leaves", path: "/leave", icon: Calendar },
  { label: "Reports", path: "/reports", icon: BarChart3 },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Birthdays", path: "/birthdays", icon: Cake },
  { label: "Settings", path: "/settings", icon: Settings },
];
const managerNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", path: "/tasks", icon: CheckSquare },
  { label: "Completed Tasks", path: "/completed-tasks", icon: CheckCircle2 },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "My Tasks", path: "/my-tasks", icon: ClipboardList },
  { label: "Team Members", path: "/team-members", icon: Workflow },
  { label: "Teams", path: "/teams", icon: Video },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "All Leaves", path: "/leave", icon: Calendar },
  { label: "My Leave", path: "/my-leave", icon: Calendar },
  { label: "Reports", path: "/reports", icon: BarChart3 },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Birthdays", path: "/birthdays", icon: Cake },
  { label: "Settings", path: "/settings", icon: Settings },
];
const employeeNav: NavItem[] = [
  { label: "Dashboard", path: "/my-dashboard", icon: LayoutDashboard },
  { label: "My Tasks", path: "/my-tasks", icon: CheckSquare },
  { label: "Completed Tasks", path: "/completed-tasks", icon: CheckCircle2 },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "Teams", path: "/my-teams", icon: Video },
  { label: "Team Members", path: "/team-members", icon: Workflow },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "Leave", path: "/my-leave", icon: Calendar },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Birthdays", path: "/birthdays", icon: Cake },
  { label: "Profile", path: "/profile", icon: User },
];
const internNav: NavItem[] = [
  { label: "Dashboard", path: "/intern-dashboard", icon: LayoutDashboard },
  { label: "My Tasks", path: "/intern-tasks", icon: CheckSquare },
  { label: "Completed Tasks", path: "/completed-tasks", icon: CheckCircle2 },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "Team Members", path: "/team-members", icon: Workflow },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Birthdays", path: "/birthdays", icon: Cake },
  { label: "Profile", path: "/profile", icon: User },
];
// Phone bottom bar: 5 fixed shortcuts per role (full menu is behind ☰ in the header)
const mobileTabPaths: Record<string, string[]> = {
  admin: ["/dashboard", "/tasks", "/completed-tasks", "/projects", "/leave"],
  manager: ["/dashboard", "/tasks", "/completed-tasks", "/projects", "/leave"],
  employee: ["/my-dashboard", "/my-tasks", "/completed-tasks", "/projects", "/my-leave"],
  intern: ["/intern-dashboard", "/intern-tasks", "/completed-tasks", "/projects", "/notes"],
};
const shortLabel: Record<string, string> = {
  "/my-tasks": "Tasks", "/intern-tasks": "Tasks", "/my-dashboard": "Dashboard",
  "/intern-dashboard": "Dashboard", "/completed-tasks": "Completed",
  "/leave": "Leave", "/my-leave": "Leave",
};

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    typeof window !== "undefined" && document.documentElement.classList.contains("dark")
  );
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const isIntern = profile?.role === "intern";
  const nav = isAdmin ? adminNav : isManager ? managerNav : isIntern ? internNav : employeeNav;
  const roleKey = isAdmin ? "admin" : isManager ? "manager" : isIntern ? "intern" : "employee";
  const mobileTabs = mobileTabPaths[roleKey]
    .map((p) => nav.find((n) => n.path === p))
    .filter(Boolean) as NavItem[];
  const currentLabel = nav.find((n) => n.path === location.pathname)?.label ?? "";
  // Close the phone menu whenever the page changes
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  // Android app: register this phone for push notifications once logged in
  useEffect(() => { if (profile?.id) initPush(navigate); }, [profile?.id, navigate]);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };
  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-card z-30">
        <div className="flex h-[60px] items-center gap-2 px-5 border-b border-border">
          {/* Both logos are always mounted — we just toggle visibility via CSS
              so the browser never has to re-fetch/decode on theme switch. */}
          <div className="relative h-28 flex items-center">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Trilo Automation"
              className={cn("h-28 object-contain transition-opacity duration-150", isDark ? "opacity-0 absolute inset-0" : "opacity-100")}
              fetchPriority="high"
              decoding="sync"
            />
            <img
              src={`${import.meta.env.BASE_URL}logo-dark.png`}
              alt="Trilo Automation"
              className={cn("h-28 object-contain transition-opacity duration-150", isDark ? "opacity-100" : "opacity-0 absolute inset-0")}
              fetchPriority="high"
              decoding="sync"
            />
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {nav.map((item) => {
              const active = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "text-primary" : "text-ink-secondary hover:bg-muted hover:text-ink-primary"
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg bg-accent-light"
                        transition={{ type: "spring", stiffness: 350, damping: 30 }}
                      />
                    )}
                    <item.icon className="relative z-10 h-[18px] w-[18px]" />
                    <span className="relative z-10">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-primary">{profile?.full_name}</p>
              <p className="truncate text-xs text-ink-muted capitalize">{profile?.role}</p>
            </div>
            <button onClick={handleSignOut} className="text-ink-muted hover:text-destructive transition-colors" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink-primary/30 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>
      {/* Mobile sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-card border-r border-border z-50 flex flex-col md:hidden pt-safe pb-safe"
          >
            <div className="flex h-[60px] items-center justify-between px-5 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="relative h-24 flex items-center">
                  <img
                    src={`${import.meta.env.BASE_URL}logo.png`}
                    alt="Trilo Automation"
                    className={cn("h-24 object-contain transition-opacity duration-150", isDark ? "opacity-0 absolute inset-0" : "opacity-100")}
                    fetchPriority="high"
                    decoding="sync"
                  />
                  <img
                    src={`${import.meta.env.BASE_URL}logo-dark.png`}
                    alt="Trilo Automation"
                    className={cn("h-24 object-contain transition-opacity duration-150", isDark ? "opacity-100" : "opacity-0 absolute inset-0")}
                    fetchPriority="high"
                    decoding="sync"
                  />
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-ink-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <ul className="space-y-1">
                {nav.map((item) => {
                  const active = location.pathname === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          active ? "bg-accent-light text-primary" : "text-ink-secondary hover:bg-muted"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px]" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-3 rounded-lg px-3 py-2">
                <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-primary">{profile?.full_name}</p>
                  <p className="truncate text-xs text-ink-muted capitalize">{profile?.role}</p>
                </div>
                <button onClick={handleSignOut} className="text-ink-muted hover:text-destructive transition-colors" title="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {/* Main content */}
      <div className="flex-1 min-w-0 md:ml-60 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-header pt-safe items-center gap-1 md:gap-2 border-b border-border bg-card/80 backdrop-blur-sm px-4 md:px-8">
          <button className="md:hidden -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary hover:bg-muted" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="md:hidden font-heading text-base font-semibold text-ink-primary truncate">{currentLabel}</span>
          <h1 className="font-heading text-lg font-semibold text-ink-primary hidden md:block">
            {nav.find((n) => n.path === location.pathname)?.label ?? ""}
          </h1>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationBell />
          <Link to="/profile" className="-mr-2 md:mr-0 flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted transition-colors" aria-label="My profile">
            <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" className="!h-8 !w-8 !text-xs" />
          </Link>
        </header>
        <main className="flex-1 px-4 pt-5 pb-24 md:px-8 md:py-8 max-w-[1280px] mx-auto w-full">
          <InstallAppBanner />
          <Outlet />
        </main>
      </div>
      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 md:hidden [transform:translateZ(0)] border-t border-border bg-card/95 backdrop-blur-md shadow-[0_-4px_16px_rgba(0,0,0,0.04)] pb-safe">
        <div className="grid grid-cols-5 h-16">
          {mobileTabs.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex flex-col items-center justify-center gap-1 min-w-0"
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    active ? "bg-accent-light text-primary" : "text-ink-muted"
                  )}
                >
                  <item.icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.2 : 1.8} />
                </span>
                <span
                  className={cn(
                    "w-full truncate text-center text-[11px] leading-none",
                    active ? "font-semibold text-primary" : "font-medium text-ink-muted"
                  )}
                >
                  {shortLabel[item.path] ?? item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
