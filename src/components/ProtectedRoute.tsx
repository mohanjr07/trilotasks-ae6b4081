import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("admin" | "manager" | "employee" | "intern" | "super_admin")[];
};

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { session, profile, loading } = useAuth();

  // Show branded loading screen while loading — covers both:
  // 1. First load (no session yet)
  // 2. Session exists but profile hasn't been fetched yet (causes double-login)
  if (loading || (session && !profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6">
          {/* Logo with pulse ring animation */}
          <div className="relative flex items-center justify-center">
            {/* Outer rotating ring */}
            <span
              className="absolute inline-block rounded-full border-2 border-primary border-t-transparent animate-spin"
              style={{ width: 88, height: 88 }}
            />
            {/* Middle pulsing ring */}
            <span
              className="absolute inline-block rounded-full border border-primary/30 animate-ping"
              style={{ width: 72, height: 72, animationDuration: "1.4s" }}
            />
            {/* Logo container */}
            <div className="relative z-10 flex items-center justify-center rounded-full bg-background shadow-md"
                 style={{ width: 64, height: 64 }}>
              <img
                src="/logo.png"
                alt="Trilo"
                className="block dark:hidden"
                style={{ width: 44, height: 44, objectFit: "contain" }}
              />
              <img
                src="/logo-dark.png"
                alt="Trilo"
                className="hidden dark:block"
                style={{ width: 44, height: 44, objectFit: "contain" }}
              />
            </div>
          </div>
          {/* Loading text */}
          <p className="text-sm text-muted-foreground tracking-widest uppercase animate-pulse select-none">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const dest = profile.role === "employee" ? "/my-dashboard" : profile.role === "intern" ? "/intern-dashboard" : "/dashboard";
    return <Navigate to={dest} replace />;
  }

  // Block manager from user management routes
  if (profile?.role === "manager" && (window.location.pathname === "/users")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
