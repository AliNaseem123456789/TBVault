import { Link } from 'react-router-dom';
import NewsletterForm from '../../features/newsletter/NewsletterForm';
import { useCompany } from '../../content/company';
import './Footer.css';

const FOOTER_COLUMNS = [
  {
    title: 'Shop',
    links: [
      { label: 'New arrivals', to: '/new-arrivals' },
      { label: 'Best sellers', to: '/best-sellers' },
      { label: 'Deals', to: '/deals' },
      { label: 'Gift cards', to: '/gift-cards' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About TBVault', to: '/about' },
      { label: 'Sell on TBVault', to: '/sell' },
      { label: 'Careers', to: '/careers' },
      { label: 'Press', to: '/press' },
      { label: 'Sustainability', to: '/sustainability' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Help center', to: '/help' },
      { label: 'Shipping & returns', to: '/shipping-returns' },
      { label: 'Track order', to: '/track' },
      { label: 'Contact us', to: '/contact' },
    ],
  },
];

/**
 * Site footer. Lives inside Layout.jsx alongside Navbar — see that
 * file for how pages get wrapped with both automatically.
 */
const Footer = () => {
  const company = useCompany();
  return (
    <footer className="footer">
      <div className="container footer__top">
        <div className="footer__brand">
          <Link to="/" className="footer__logo">
            TB<span>Vault</span>
          </Link>
          <p>Everyday gear from verified sellers, with card or cash on delivery. Get drops, deals and restock alerts:</p>
          <NewsletterForm tone="dark" />
          <p className="footer__contact">
            <a href={`mailto:${company.email}`}>{company.email}</a>
            <span>{company.hours}</span>
          </p>
        </div>

        <nav className="footer__columns" aria-label="Footer">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="footer__column">
              <h2>{col.title}</h2>
              <ul>
                {col.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="container footer__bottom">
        <p>&copy; {new Date().getFullYear()} {company.legalName}. All rights reserved.</p>
        <div className="footer__bottom-links">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
