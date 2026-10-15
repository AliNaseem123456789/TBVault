import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import { CartProvider } from "./features/cart/CartProvider";
import { WishlistProvider } from "./features/wishlist/WishlistProvider";
import ProtectedRoute from "./features/auth/ProtectedRoute";
import Login from "./features/auth/Login";
import Profile from "./features/auth/Profile";
import Signup from "./features/auth/Signup";
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
import Deals from "./pages/Deals/Deals";
import Wishlist from "./pages/Wishlist/Wishlist";
import TrackOrder, { TrackLookup } from "./pages/Track/TrackOrder";
import Invoice from "./pages/Invoice/Invoice";
import Unauthorized from "./pages/Unauthorized/Unauthorized";
import Sell from "./pages/Sell/Sell";
import SellerDashboard from "./pages/Seller/SellerDashboard";
import Wallet from "./pages/Wallet/Wallet";
import StorePage from "./pages/Store/StorePage";
import ChatPage from "./pages/Chat/ChatPage";
import Collection from "./pages/Collection/Collection";
import About from "./pages/Info/About";
import Careers from "./pages/Info/Careers";
import Press from "./pages/Info/Press";
import Sustainability from "./pages/Info/Sustainability";
import HelpCenter from "./pages/Info/HelpCenter";
import ShippingReturns from "./pages/Info/ShippingReturns";
import Contact from "./pages/Info/Contact";
import Privacy from "./pages/Info/Privacy";
import Terms from "./pages/Info/Terms";
import GiftCards from "./pages/Info/GiftCards";
import { ChatProvider } from "./features/chatbot/ChatProvider";

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
        <WishlistProvider>
        <ChatProvider>
        <Routes>
          {/* Public storefront pages — share the Navbar/Footer/cart-drawer
              shell from Layout.jsx. Add new public pages (Shop, Product,
              Categories...) as siblings of Landing inside this same
              parent route. See ARCHITECTURE.md -> "Adding a new page". */}
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/deals" element={<Deals />} />
            {/* Guests can check out too; signed-in customers get their saved addresses. */}
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/track" element={<TrackLookup />} />
            <Route path="/track/:token" element={<TrackOrder />} />
            <Route path="/sell" element={<Sell />} />
            <Route path="/stores/:slug" element={<StorePage />} />
            <Route path="/chat" element={<ChatPage />} />
            {/* Footer pages */}
            <Route path="/new-arrivals" element={<Collection key="new-arrivals" kind="new-arrivals" />} />
            <Route path="/best-sellers" element={<Collection key="best-sellers" kind="best-sellers" />} />
            <Route path="/gift-cards" element={<GiftCards />} />
            <Route path="/about" element={<About />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/press" element={<Press />} />
            <Route path="/sustainability" element={<Sustainability />} />
            <Route path="/help" element={<HelpCenter />} />
            <Route path="/shipping-returns" element={<ShippingReturns />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />

            {/* Logged-in pages that are still part of the storefront (keep
                the Navbar/Footer/cart) nest ProtectedRoute here instead of
                as a separate top-level block. */}
            <Route element={<ProtectedRoute />}>
              <Route path="/profile" element={<Profile />} />
              <Route path="/wishlist" element={<Wishlist />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/wallet" element={<Wallet />} />
            </Route>

            {/* Approved sellers (and admins who also sell). The API checks the seller account on every call. */}
            <Route element={<ProtectedRoute requireSeller />}>
              <Route path="/seller" element={<SellerDashboard />} />
            </Route>

            {/* Admin only. ProtectedRoute waits for /auth/me before checking the role. */}
            <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>

            <Route path="/unauthorized" element={<Unauthorized />} />
          </Route>

          {/* Printable receipts: no site chrome, so printing gives a clean page. */}
          <Route element={<ProtectedRoute />}>
            <Route path="/orders/:id/invoice" element={<Invoice />} />
          </Route>
          <Route path="/track/:token/invoice" element={<Invoice />} />

          <Route path="/oauth-success" element={<OAuthSuccess />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/confirm-email" element={<ConfirmEmail />} />

          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/login" element={<Login />} />
          <Route path="/sign-up" element={<Signup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ChatProvider>
        </WishlistProvider>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
