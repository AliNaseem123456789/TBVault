import { NavLink } from 'react-router-dom';
import './InfoPage.css';

// Sibling pages listed in the side menu, by section.
const SECTIONS = {
  support: [
    { to: '/help', label: 'Help center' },
    { to: '/shipping-returns', label: 'Shipping & returns' },
    { to: '/track', label: 'Track order' },
    { to: '/contact', label: 'Contact us' },
  ],
  company: [
    { to: '/about', label: 'About TBVault' },
    { to: '/careers', label: 'Careers' },
    { to: '/press', label: 'Press' },
    { to: '/sustainability', label: 'Sustainability' },
  ],
  legal: [
    { to: '/privacy', label: 'Privacy policy' },
    { to: '/terms', label: 'Terms of service' },
  ],
};

/**
 * Shell for the footer's text pages: a heading band, then the content with a
 * side menu of the pages in the same section.
 *   <InfoPage section="support" eyebrow="Support" title="Help center" lead="...">...</InfoPage>
 * Content inside gets readable text styles from `.prose` (InfoPage.css).
 */
const InfoPage = ({ section, eyebrow, title, lead, actions, children, wide = false }) => {
  const links = SECTIONS[section];
  return (
    <div className="info-page">
      <header className="info-page__header">
        <div className="container">
          {eyebrow && <span className="info-page__eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {lead && <p className="info-page__lead">{lead}</p>}
          {actions && <div className="info-page__actions">{actions}</div>}
        </div>
      </header>
      <div className={`container info-page__body ${links ? 'has-menu' : ''}`}>
        {links && (
          <nav className="info-page__menu" aria-label={`${eyebrow || title} pages`}>
            <ul>
              {links.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} end>{l.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className={`info-page__content ${wide ? 'is-wide' : 'prose'}`}>{children}</div>
      </div>
    </div>
  );
};

export default InfoPage;
