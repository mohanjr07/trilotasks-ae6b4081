import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TriloLoader from "@/components/TriloLoader";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("admin" | "manager" | "employee" | "intern" | "super_admin")[];
};

const LoadingScreen = () => <TriloLoader />;

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
