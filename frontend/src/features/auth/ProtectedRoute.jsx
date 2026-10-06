import { useAuth } from "./AuthProvider";
import { Navigate, Outlet, useLocation } from "react-router-dom";

const ProtectedRoute = ({ allowedRoles }) => {
  const { isAuthenticated, user, userLoading } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles) {
    // Don't judge the role until /auth/me has answered.
    if (userLoading) {
      return <div className="container" style={{ padding: "var(--space-9) 0" }} aria-busy="true" />;
    }
    if (!allowedRoles.includes(user?.role)) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <Outlet />;
};

export default ProtectedRoute;
