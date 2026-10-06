import { Link } from 'react-router-dom';
import './Footer.css';

const FOOTER_COLUMNS = [
  { title: 'Shop', links: ['New arrivals', 'Best sellers', 'Deals', 'Gift cards'] },
  { title: 'Company', links: ['About TBVault', 'Careers', 'Press', 'Sustainability'] },
  { title: 'Support', links: ['Help center', 'Shipping & returns', 'Track order', 'Contact us'] },
];

/**
 * Site footer. Lives inside Layout.jsx alongside Navbar — see that
 * file for how pages get wrapped with both automatically.
 */
const Footer = () => {
  return (
    <footer className="footer">
      <div className="container footer__top">
        <div className="footer__brand">
          <span className="footer__logo">
            TB<span>Vault</span>
          </span>
          <p>Modern essentials, curated and delivered. Sign up for drops, deals, and restock alerts.</p>
          <form className="footer__form" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder="you@email.com" aria-label="Email address" required />
            <button type="submit" className="btn btn-primary btn-sm">Subscribe</button>
          </form>
        </div>

        <div className="footer__columns">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="footer__column">
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((link) => (
                  <li key={link}>
                    <Link to="/">{link}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="container footer__bottom">
        <p>&copy; {new Date().getFullYear()} TBVault. All rights reserved.</p>
        <div className="footer__bottom-links">
          <Link to="/">Privacy</Link>
          <Link to="/">Terms</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
