import { Link } from 'react-router-dom';
import './AuthLayout.css';

/**
 * Shared centered-card shell for every auth screen (login, signup,
 * password reset, email verification, profile...). Pass a `title`
 * and optional `subtitle` + `footer`; the form/content goes as
 * children. Keeps every auth page visually consistent without
 * duplicating the wrapper markup in each one.
 */
const AuthLayout = ({ title, subtitle, footer, children }) => {
  return (
    <div className="auth-shell">
      <Link to="/" className="auth-shell__logo">
        TB<span>Vault</span>
      </Link>
      <div className="auth-shell__card card">
        <div className="auth-shell__header">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="auth-shell__footer">{footer}</div>}
      </div>
    </div>
  );
};

export default AuthLayout;
