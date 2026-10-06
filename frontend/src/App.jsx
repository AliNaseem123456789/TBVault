import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import { CartProvider } from "./features/cart/CartProvider";
import ProtectedRoute from "./features/auth/ProtectedRoute";
import Login from "./features/auth/Login";
import Profile from "./features/auth/Profile";
import Signup from "./features/auth/signup";
import OAuthSuccess from "./features/auth/OAuthSuccess";
import ResetPassword from "./features/auth/ResetPassword";
import VerifyEmail from "./features/auth/VerifyEmail";
import ConfirmEmail from "./features/auth/ConfirmEmail";
import ForgotPassword from "./features/auth/ForgotPassword";

import Layout from "./components/layout/Layout";
import Landing from "./pages/Landing/Landing";
import Shop from "./pages/Shop/Shop";
import ProductDetail from "./pages/ProductDetail/ProductDetail";
import Checkout from "./pages/Checkout/Checkout";
import Orders from "./pages/Orders/Orders";
import OrderDetail from "./pages/OrderDetail/OrderDetail";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import Unauthorized from "./pages/Unauthorized/Unauthorized";

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
        <Routes>
          {/* Public storefront pages — share the Navbar/Footer/cart-drawer
              shell from Layout.jsx. Add new public pages (Shop, Product,
              Categories...) as siblings of Landing inside this same
              parent route. See ARCHITECTURE.md -> "Adding a new page". */}
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/products/:id" element={<ProductDetail />} />

            {/* Logged-in pages that are still part of the storefront (keep
                the Navbar/Footer/cart) nest ProtectedRoute here instead of
                as a separate top-level block. */}
            <Route element={<ProtectedRoute />}>
              <Route path="/profile" element={<Profile />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
            </Route>

            {/* Admin only. ProtectedRoute waits for /auth/me before checking the role. */}
            <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>

            <Route path="/unauthorized" element={<Unauthorized />} />
          </Route>

          <Route path="/oauth-success" element={<OAuthSuccess />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/confirm-email" element={<ConfirmEmail />} />

          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/login" element={<Login />} />
          <Route path="/sign-up" element={<Signup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
