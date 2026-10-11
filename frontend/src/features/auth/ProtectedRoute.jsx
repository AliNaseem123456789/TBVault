import { useAuth } from "./AuthProvider";
import { Navigate, Outlet, useLocation } from "react-router-dom";

// allowedRoles: only these roles. requireSeller: only users with an approved seller account
// (non-sellers are sent to /sell, where they can apply or see their application).
const ProtectedRoute = ({ allowedRoles, requireSeller = false }) => {
  const { isAuthenticated, user, userLoading, isSeller } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles || requireSeller) {
    // Don't judge the role until /auth/me has answered.
    if (userLoading) {
      return <div className="container" style={{ padding: "var(--space-9) 0" }} aria-busy="true" />;
    }
    if (allowedRoles && !allowedRoles.includes(user?.role)) {
      return <Navigate to="/unauthorized" replace />;
    }
    if (requireSeller && !isSeller) {
      return <Navigate to="/sell" replace />;
    }
  }

  return <Outlet />;
};

export default ProtectedRoute;
