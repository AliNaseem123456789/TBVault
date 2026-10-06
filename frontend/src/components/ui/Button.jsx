import { Link } from 'react-router-dom';

/**
 * Shared button. Renders a <button>, or — when `to` is passed — a
 * router <Link> styled identically. Use this instead of writing
 * raw <button>/<a> tags with the .btn classes by hand, so every
 * button in the app stays visually consistent.
 *
 *   <Button variant="primary" to="/shop">Shop now</Button>
 *   <Button variant="ghost" size="lg" onClick={...}>Learn more</Button>
 *
 * variant: 'primary' | 'ghost' | 'light'   size: 'sm' | 'lg' (default: base)
 */
const Button = ({ variant = 'primary', size, to, className = '', children, ...rest }) => {
  const classes = `btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`.trim();

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
};

export default Button;
