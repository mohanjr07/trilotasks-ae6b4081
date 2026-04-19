import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("admin" | "manager" | "employee" | "intern" | "intern_admin")[];
};

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const dest = profile.role === "employee" ? "/my-dashboard" : profile.role === "intern" ? "/intern-dashboard" : profile.role === "intern_admin" ? "/intern-admin-dashboard" : "/dashboard";
    return <Navigate to={dest} replace />;
  }

  // Block manager from user management routes
  if (profile?.role === "manager" && (window.location.pathname === "/users")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
