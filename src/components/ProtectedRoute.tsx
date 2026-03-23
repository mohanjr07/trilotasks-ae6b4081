import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: ("super_admin" | "admin" | "employee")[];
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
    const dest = profile.role === "employee" ? "/my-dashboard" : "/dashboard";
    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
}
