import { useState, useEffect, useRef, Suspense } from "react";
import { usePendingCounts } from "@/hooks/usePendingCounts";
import { initPush } from "@/lib/push";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import InstallAppBanner from "@/components/InstallAppBanner";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, CheckSquare, Users, Calendar, BarChart3,
  Settings, User, Bell, LogOut, Menu, X, Video, StickyNote, ClipboardList, FolderKanban, Network,
  FileStack, ClipboardCheck, Cake, Package, CheckCircle2, Folder, Target, Contact, Workflow, Wallet, Fingerprint, Timer, CalendarRange, Receipt, Megaphone,
} from "lucide-react";
import AnnouncementPopup from "@/components/AnnouncementPopup";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageSkeleton from "@/components/PageSkeleton";
import { preloadRoute, preloadAllRoutes } from "@/lib/routePreload";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import NotificationBell from "@/components/NotificationBell";
import GetStartedIntro from "@/components/GetStartedIntro";
import { syncThemeFromAccount } from "@/lib/theme";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { canSeeOvertime } from "@/pages/OvertimePage";
type NavItem = { label: string; path: string; icon: typeof LayoutDashboard };
const adminNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", path: "/tasks", icon: CheckSquare },
  { label: "Completed Tasks", path: "/completed-tasks", icon: CheckCircle2 },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Production Plan", path: "/production-plan", icon: CalendarRange },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Payslips", path: "/payslips", icon: Receipt },
  { label: "Overtime", path: "/overtime", icon: Timer },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "My Forms & Approvals", path: "/form-requests", icon: ClipboardCheck },
  { label: "Users", path: "/users", icon: Users },
  { label: "Announcements", path: "/announcements", icon: Megaphone },
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
  { label: "Production Plan", path: "/production-plan", icon: CalendarRange },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Payslips", path: "/payslips", icon: Receipt },
  { label: "Overtime", path: "/overtime", icon: Timer },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "My Forms & Approvals", path: "/form-requests", icon: ClipboardCheck },
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
  { label: "Production Plan", path: "/production-plan", icon: CalendarRange },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Payslips", path: "/payslips", icon: Receipt },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "My Forms & Approvals", path: "/form-requests", icon: ClipboardCheck },
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
  { label: "Production Plan", path: "/production-plan", icon: CalendarRange },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Assets", path: "/assets", icon: Package },
  { label: "People", path: "/people", icon: Contact },
  { label: "KRA & KPI", path: "/kra-kpi", icon: Target },
  { label: "Documents", path: "/documents", icon: Folder },
  { label: "Payments", path: "/payments", icon: Wallet },
  { label: "Payslips", path: "/payslips", icon: Receipt },
  { label: "Forms and Formats", path: "/production-forms", icon: FileStack },
  { label: "My Forms & Approvals", path: "/form-requests", icon: ClipboardCheck },
  { label: "Team Members", path: "/team-members", icon: Workflow },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Birthdays", path: "/birthdays", icon: Cake },
  { label: "Profile", path: "/profile", icon: User },
];
// Phone bottom bar: 5 fixed shortcuts per role (full menu is behind ☰ in the header)
const mobileTabPaths: Record<string, string[]> = {
  admin: ["/dashboard", "/tasks", "/payments", "/projects", "/leave"],
  manager: ["/dashboard", "/tasks", "/payments", "/projects", "/leave"],
  employee: ["/my-dashboard", "/my-tasks", "/payments", "/projects", "/my-leave"],
  intern: ["/intern-dashboard", "/intern-tasks", "/payments", "/projects", "/notes"],
};
const shortLabel: Record<string, string> = {
  "/my-tasks": "Tasks", "/intern-tasks": "Tasks", "/my-dashboard": "Dashboard",
  "/intern-dashboard": "Dashboard", "/completed-tasks": "Completed",
  "/leave": "Leave", "/my-leave": "Leave",
};

export default function AppLayout() {
  const { profile, signOut, user: authUser } = useAuth() as any;
  // use the theme saved in the account (Settings → Appearance)
  useEffect(() => { syncThemeFromAccount(authUser?.user_metadata); }, [authUser?.id]);
  const pending = usePendingCounts();   // red number badges: things waiting for me
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    typeof window !== "undefined" && document.documentElement.classList.contains("dark")
  );
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const isIntern = profile?.role === "intern";
  const baseNav = isAdmin ? adminNav : isManager ? managerNav : isIntern ? internNav : employeeNav;
  // Overtime: admins, managers and Anu (whatever her role)
  const nav = canSeeOvertime(profile as any) && !baseNav.some((n) => n.path === "/overtime")
    ? baseNav.flatMap((n) => (n.path === "/payments" ? [n, { label: "Overtime", path: "/overtime", icon: Timer }] : [n]))
    : baseNav;
  const roleKey = isAdmin ? "admin" : isManager ? "manager" : isIntern ? "intern" : "employee";
  const mobileTabs = mobileTabPaths[roleKey]
    .map((p) => nav.find((n) => n.path === p))
    .filter(Boolean) as NavItem[];
  const currentLabel = nav.find((n) => n.path === location.pathname)?.label ?? "";
  // phone header: "Good Morning" on the home tab, the page name elsewhere
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const isHome = ["/dashboard", "/my-dashboard", "/intern-dashboard"].includes(location.pathname);
  // bottom bar: press and slide a finger along it to move between tabs (the dark pill follows)
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean; idx: number | null } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const tabAt = (x: number) => {
    const tabs = Array.from(barRef.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []);
    const i = tabs.findIndex((t) => { const r = t.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    return i < 0 ? null : i;
  };
  const onBarDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, moved: false, idx: null }; };
  const onBarMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 10) return;
      d.moved = true;
      try { barRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const i = tabAt(e.clientX);
    if (i !== null && i !== d.idx) {
      d.idx = i;
      setDragIdx(i);
      try { navigator.vibrate?.(8); } catch { /* not supported */ }
    }
  };
  const onBarUp = () => {
    const d = drag.current;
    if (d?.moved && d.idx !== null && mobileTabs[d.idx]) navigate(mobileTabs[d.idx].path);
    // keep the "was a drag" flag until the click that follows, then clear
    setTimeout(() => { drag.current = null; setDragIdx(null); }, 0);
  };
  // only ONE header is mounted (phone or desktop) — two NotificationBells would
  // open the same realtime channel twice and crash the app
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Close the phone menu whenever the page changes
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  // every new page starts at the top (no landing half-way down the previous page's scroll)
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }); }, [location.pathname]);
  // once signed in, quietly download the other pages so they open instantly (bottom-bar tabs first)
  useEffect(() => { if (profile?.id) preloadAllRoutes(mobileTabs.map((t) => t.path)); }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
              const active = location.pathname === item.path || (item.path === "/production-plan" && location.pathname.startsWith("/production-plan/")) || (item.path === "/projects" && location.pathname.startsWith("/project-forms"));
              return (
                <li key={item.path}>
                  <Link
                    to={item.path} onMouseEnter={() => preloadRoute(item.path)} onTouchStart={() => preloadRoute(item.path)}
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
                    {pending[item.path] ? <span className="relative z-10 ml-auto min-w-[20px] rounded-full bg-destructive px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-destructive-foreground">{pending[item.path] > 99 ? "99+" : pending[item.path]}</span> : null}
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
                  const active = location.pathname === item.path || (item.path === "/production-plan" && location.pathname.startsWith("/production-plan/")) || (item.path === "/projects" && location.pathname.startsWith("/project-forms"));
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path} onMouseEnter={() => preloadRoute(item.path)} onTouchStart={() => preloadRoute(item.path)}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          active ? "bg-accent-light text-primary" : "text-ink-secondary hover:bg-muted"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px]" />
                        <span>{item.label}</span>
                        {pending[item.path] ? <span className="ml-auto min-w-[20px] rounded-full bg-destructive px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-destructive-foreground">{pending[item.path] > 99 ? "99+" : pending[item.path]}</span> : null}
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
        {/* Phone header: menu + greeting / page title, round action buttons, profile on the right */}
        {!isDesktop && (
        <header className="md:hidden sticky top-0 z-20 pt-safe bg-background">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => setSidebarOpen(true)} aria-label="Open menu"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full gloss-btn text-ink-primary dark:bg-ink-primary dark:text-background shadow-md active:scale-95 transition-transform">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[15px] max-[389px]:text-[13px] font-semibold text-ink-primary">
                {isHome ? `${greeting}` : currentLabel || "TaskFlow"}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {isHome ? (profile?.full_name ?? "") : `${greeting}, ${firstName}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 max-[389px]:gap-1.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-sm [&>button]:h-11 [&>button]:w-11"><ThemeToggle /></span>
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-sm [&>div>button]:h-11 [&>div>button]:w-11"><NotificationBell /></span>
              <Link to="/profile" aria-label="My profile" className="shrink-0 rounded-full ring-2 ring-card shadow-sm">
                <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" className="!h-11 !w-11 !text-sm" />
              </Link>
            </div>
          </div>
        </header>
        )}
        {/* Desktop header */}
        {isDesktop && (
        <header className="hidden md:flex sticky top-0 z-20 h-header pt-safe items-center gap-2 border-b border-border bg-card/80 backdrop-blur-sm px-8">
          <h1 className="font-heading text-lg font-semibold text-ink-primary hidden md:block">
            {nav.find((n) => n.path === location.pathname)?.label ?? ""}
          </h1>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationBell />
          <Link to="/profile" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted transition-colors" aria-label="My profile">
            <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" className="!h-8 !w-8 !text-xs" />
          </Link>
        </header>
        )}
        <main className="flex-1 px-4 pt-2 pb-32 md:px-8 md:py-8 max-w-[1280px] mx-auto w-full">
          <InstallAppBanner />
          <AnnouncementPopup />
          <Suspense fallback={<PageSkeleton />}>
            <ErrorBoundary inline key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </Suspense>
        </main>
      </div>
      <GetStartedIntro />
      {/* Mobile bottom tab bar — floating dark bar (same dark as the summary boxes), white pill on the active tab */}
      <nav className="fixed inset-x-3 z-30 md:hidden [transform:translateZ(0)]" style={{ bottom: "calc(var(--sab) + 10px)" }}>
        <div ref={barRef} onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}
          style={{ touchAction: "none" }}
          className="flex h-[68px] items-center gap-1 rounded-[28px] border tabbar-dark p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.28)] select-none">
          {mobileTabs.map((item, idx) => {
            const active = dragIdx !== null ? dragIdx === idx : (location.pathname === item.path || (item.path === "/production-plan" && location.pathname.startsWith("/production-plan/")) || (item.path === "/projects" && location.pathname.startsWith("/project-forms")));
            return (
              <Link
                key={item.path}
                to={item.path} onMouseEnter={() => preloadRoute(item.path)} onTouchStart={() => preloadRoute(item.path)}
                data-tab
                draggable={false}
                onClick={(e) => { if (drag.current?.moved) e.preventDefault(); }}
                className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[22px]"
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  // while sliding: the pill lifts and grows into a clear "liquid glass" lens
                  <motion.span layoutId="mobile-tab-pill"
                    className={cn("absolute inset-0 rounded-[22px]", dragIdx !== null ? "glass-pill" : "bg-ink-primary dark:bg-white shadow-md")}
                    animate={{ scale: dragIdx !== null ? 1.18 : 1, y: dragIdx !== null ? -7 : 0 }}
                    transition={{ type: "spring", stiffness: 380, damping: 26, mass: 0.8 }} />
                )}
                <span className={cn("relative z-10 flex items-center justify-center transition-transform duration-200",
                  active && dragIdx !== null ? "-translate-y-[7px] scale-[1.18] text-ink-primary dark:text-white" : active ? "text-white dark:text-neutral-900" : "text-ink-secondary dark:text-white/60")}>
                  <item.icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.2 : 1.8} />
                  {pending[item.path] ? (
                    <span className="absolute -top-2 -right-3 min-w-[18px] rounded-full bg-destructive px-1 py-0.5 text-center text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-[var(--tabbar-bg)]">
                      {pending[item.path] > 99 ? "99+" : pending[item.path]}
                    </span>
                  ) : null}
                </span>
                <span className={cn("relative z-10 w-full truncate px-0.5 text-center text-[10.5px] leading-none transition-transform duration-200",
                  active && dragIdx !== null ? "-translate-y-[7px] scale-110 font-semibold text-ink-primary dark:text-white"
                    : active ? "font-semibold text-white dark:text-neutral-900" : "font-medium text-ink-secondary dark:text-white/60")}>
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
