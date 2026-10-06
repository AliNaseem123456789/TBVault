import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Icon from '../ui/Icon';
import Button from '../ui/Button';
import { useCart } from '../../features/cart/CartProvider';
import { useAuth } from '../../features/auth/AuthProvider';
import './Navbar.css';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/shop', label: 'Shop' },
  { to: '/deals', label: 'Deals' },
];

/**
 * Sticky site header. Lives inside Layout.jsx so it appears on
 * every public page automatically — don't import Navbar directly
 * inside a page component. Add new top-level nav links to
 * NAV_LINKS above (they need a matching <Route> in App.jsx too).
 */
const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { count: cartCount, openCart } = useCart();
  const { isAuthenticated, isAdmin } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`navbar ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="container navbar__inner">
        <Link to="/" className="navbar__logo">
          TB<span>Vault</span>
        </Link>

        <nav className="navbar__links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className="navbar__link" end={link.to === '/'}>
              {link.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" className="navbar__link">
              Admin
            </NavLink>
          )}
        </nav>

        <div className="navbar__actions">
          <button className="navbar__icon-btn" aria-label="Search" type="button">
            <Icon name="search" size={19} />
          </button>
          <Link
            to={isAuthenticated ? '/profile' : '/login'}
            className="navbar__icon-btn"
            aria-label="Account"
          >
            <Icon name="user" size={19} />
          </Link>
          <button className="navbar__icon-btn navbar__cart" aria-label="Cart" type="button" onClick={openCart}>
            <Icon name="cart" size={19} />
            {cartCount > 0 && <span className="navbar__cart-count">{cartCount}</span>}
          </button>
          <Button to="/sign-up" size="sm" className="navbar__cta">Get started</Button>
          <button
            className="navbar__icon-btn navbar__menu-toggle"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            type="button"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="navbar__mobile" aria-label="Mobile">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className="navbar__mobile-link" onClick={() => setMenuOpen(false)}>
              {link.label}
            </NavLink>
          ))}
          <Link
            to={isAuthenticated ? '/profile' : '/login'}
            className="navbar__mobile-link"
            onClick={() => setMenuOpen(false)}
          >
            Account
          </Link>
          {isAdmin && (
            <NavLink to="/admin" className="navbar__mobile-link" onClick={() => setMenuOpen(false)}>
              Admin
            </NavLink>
          )}
        </nav>
      )}
    </header>
  );
};

export default Navbar;
