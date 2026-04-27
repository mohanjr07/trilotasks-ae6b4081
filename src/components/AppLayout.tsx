import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, CheckSquare, Users, Calendar, BarChart3,
  Settings, User, Bell, LogOut, Menu, X, Video, StickyNote, ClipboardList, FolderKanban, Network,
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
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Users", path: "/users", icon: Users },
  { label: "Teams", path: "/teams", icon: Video },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "All Leaves", path: "/leave", icon: Calendar },
  { label: "Reports", path: "/reports", icon: BarChart3 },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Settings", path: "/settings", icon: Settings },
];

const managerNav: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", path: "/tasks", icon: CheckSquare },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "My Tasks", path: "/my-tasks", icon: ClipboardList },
  { label: "Teams", path: "/teams", icon: Video },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "All Leaves", path: "/leave", icon: Calendar },
  { label: "My Leave", path: "/my-leave", icon: Calendar },
  { label: "Reports", path: "/reports", icon: BarChart3 },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Settings", path: "/settings", icon: Settings },
];

const employeeNav: NavItem[] = [
  { label: "Dashboard", path: "/my-dashboard", icon: LayoutDashboard },
  { label: "My Tasks", path: "/my-tasks", icon: CheckSquare },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Teams", path: "/my-teams", icon: Video },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "Leave", path: "/my-leave", icon: Calendar },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Profile", path: "/profile", icon: User },
];

const internNav: NavItem[] = [
  { label: "Dashboard", path: "/intern-dashboard", icon: LayoutDashboard },
  { label: "My Tasks", path: "/intern-tasks", icon: CheckSquare },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Organisation Flow", path: "/organisation-flow", icon: Network },
  { label: "Notes", path: "/notes", icon: StickyNote },
  { label: "Profile", path: "/profile", icon: User },
];

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
            initial={{ x: -240 }} animate={{ x: 0 }} exit={{ x: -240 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 left-0 w-60 bg-card border-r border-border z-50 flex flex-col md:hidden"
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
      <div className="flex-1 md:ml-60 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-[60px] items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4 md:px-8">
          <button className="md:hidden text-ink-secondary" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="font-heading text-lg font-semibold text-ink-primary hidden md:block">
            {nav.find((n) => n.path === location.pathname)?.label ?? ""}
          </h1>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationBell />
          <Link to="/profile">
            <UserAvatar name={profile?.full_name ?? ""} avatarUrl={profile?.avatar_url} size="sm" />
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-[1280px] mx-auto w-full">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 flex md:hidden border-t border-border bg-card z-30">
        {nav.slice(0, 5).map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-ink-muted"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
