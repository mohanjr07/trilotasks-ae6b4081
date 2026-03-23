import { Navigate } from "react-router-dom";

// TeamPage redirects to /users for admins
export default function TeamPage() {
  return <Navigate to="/users" replace />;
}
