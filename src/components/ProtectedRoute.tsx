import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("admin" | "manager" | "employee" | "intern" | "super_admin")[];
};

const TriloEmblem = () => (
  <svg
    viewBox="0 0 200 220"
    xmlns="http://www.w3.org/2000/svg"
    width="72"
    height="72"
    aria-label="Trilo"
  >
    <defs>
      <linearGradient id="triloGrad" x1="0%" y1="0%" x2="60%" y2="100%">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="45%" stopColor="#818cf8" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    {/* Left arm */}
    <path
      d="M100 95 L30 30 Q18 18 28 10 Q38 2 48 14 L108 78"
      fill="none"
      stroke="url(#triloGrad)"
      strokeWidth="18"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Right arm */}
    <path
      d="M100 95 L170 30 Q182 18 172 10 Q162 2 152 14 L92 78"
      fill="none"
      stroke="url(#triloGrad)"
      strokeWidth="18"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Stem */}
    <path
      d="M100 95 L100 200"
      fill="none"
      stroke="url(#triloGrad)"
      strokeWidth="18"
      strokeLinecap="round"
    />
  </svg>
);

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
          style={{ width: 88, height: 88 }}
        >
          <TriloEmblem />
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
