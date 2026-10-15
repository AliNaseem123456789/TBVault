import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import CartDrawer from '../../features/cart/CartDrawer';
import ChatWidget from '../../features/chatbot/ChatWidget';

// Only true statements about the store (see checkout and order tracking).
const ANNOUNCEMENT = 'Pay by card or cash on delivery · Track any order without an account';

/**
 * Shared shell for public storefront pages: announcement bar +
 * Navbar up top, <Outlet /> for the page content, Footer at the
 * bottom. Add any new public page as a sibling route under the same
 * <Route element={<Layout />}> block in App.jsx so it automatically
 * gets this chrome — don't import Navbar/Footer inside the page
 * itself. See ARCHITECTURE.md → "Adding a new page".
 */
const Layout = () => {
  const { pathname } = useLocation();

  // A new page starts at the top (filters that only change ?query keep their place).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); // not the site's smooth scroll
  }, [pathname]);

  return (
    <>
      <div className="announcement-bar">{ANNOUNCEMENT}</div>
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <ChatWidget />
    </>
  );
};

export default Layout;
