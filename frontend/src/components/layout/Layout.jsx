import { Outlet } from 'react-router-dom';
import Marquee from '../ui/Marquee';
import Navbar from './Navbar';
import Footer from './Footer';
import CartDrawer from '../../features/cart/CartDrawer';

const ANNOUNCEMENTS = ['Free shipping over $50', 'New arrivals every week', '30-day easy returns'];

/**
 * Shared shell for public storefront pages: announcement marquee +
 * Navbar up top, <Outlet /> for the page content, Footer at the
 * bottom. Add any new public page (Shop, Product, Cart,
 * Categories...) as a sibling route under the same
 * <Route element={<Layout />}> block in App.jsx so it automatically
 * gets this chrome — don't import Navbar/Footer inside the page
 * itself. See ARCHITECTURE.md → "Adding a new page".
 */
const Layout = () => {
  return (
    <>
      <Marquee items={ANNOUNCEMENTS} tone="accent" />
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
    </>
  );
};

export default Layout;
