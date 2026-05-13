import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("admin" | "manager" | "employee" | "intern" | "super_admin")[];
};

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-6">
      <div className="relative flex items-center justify-center">
        {/* Outer spinning ring */}
        <span
          className="absolute rounded-full border-2 border-t-transparent animate-spin"
          style={{
            width: 120,
            height: 120,
            borderColor: "#818cf8 transparent transparent transparent",
          }}
        />
        {/* Inner pulsing ring */}
        <span
          className="absolute rounded-full animate-ping"
          style={{
            width: 100,
            height: 100,
            border: "1px solid #818cf840",
            animationDuration: "1.5s",
          }}
        />
        {/* Emblem — sized to fill the ring */}
        <div
          className="relative z-10 flex items-center justify-center rounded-full bg-background"
          style={{ width: 110, height: 110 }}
        >
          <img src="/logo-emblem.png" alt="Trilo" width={110} height={110} style={{ objectFit: "contain" }} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground tracking-widest uppercase animate-pulse select-none">
        Loading…
      </p>
    </div>
  </div>
);

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { session, profile, loading } = useAuth();

  if (loading || (session && !profile)) {
    return <LoadingScreen />;
  }

  if (!session) return <Navigate to="/login" replace />;

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const dest =
      profile.role === "employee"
        ? "/my-dashboard"
        : profile.role === "intern"
        ? "/intern-dashboard"
        : "/dashboard";
    return <Navigate to={dest} replace />;
  }

  if (profile?.role === "manager" && window.location.pathname === "/users") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
