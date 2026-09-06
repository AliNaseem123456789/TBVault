import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import ProtectedRoute from "./features/auth/ProtectedRoute";
import Login from "./features/auth/Login";
import Profile from "./features/auth/profile";
import Signup from "./features/auth/signup";
import OAuthSuccess from "./features/auth/OAuthSuccess";
// import AdminDashboard from "./features/admin/AdminDashboard";
// import Unauthorized from "./pages/Unauthorized";
import ResetPassword from "./features/auth/ResetPassword";
import VerifyEmail from "./features/auth/VerifyEmail";
import ConfirmEmail from "./features/auth/ConfirmEmail";
import ForgotPassword from "./features/auth/ForgotPassword";

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/oauth-success" element={<OAuthSuccess />} />
<Route path="/forgot-password" element={<ForgotPassword />} />
<Route path="/reset-password" element={<ResetPassword />} />
<Route path="/confirm-email" element={<ConfirmEmail />} />

<Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/login" element={<Login />} />
          <Route path="/sign-up" element={<Signup />} />
          {/* <Route path="/unauthorized" element={<Unauthorized />} /> */}

          {/* any logged-in user */}
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* only CUSTOMER or ADMIN roles */}
          <Route element={<ProtectedRoute allowedRoles={["CUSTOMER", "ADMIN"]} />}>
            {/* <Route path="/orders" element={<Orders />} /> */}
          </Route>

          {/* only ADMIN */}
          <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
            {/* <Route path="/admin" element={<AdminDashboard />} /> */}
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;