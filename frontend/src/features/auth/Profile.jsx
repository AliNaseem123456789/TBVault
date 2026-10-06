import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useCart } from '../cart/CartProvider';
import { verifyEmail, logoutAll as logoutAllApi } from '../../api/auth.api';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import './Profile.css';

/**
 * Account page — a real site page (rendered inside Layout, so it gets
 * the Navbar/Footer/cart drawer like Shop/ProductDetail) rather than
 * the narrow centered AuthLayout card the other auth screens use.
 *
 * `user` on AuthProvider is only fetched once (app load / login), so
 * it can go stale the moment something outside this page's own clicks
 * changes it — most notably is_verified flipping true in a /confirm-email
 * tab. refreshUser() on mount fixes the common case; handleVerifyEmail's
 * "already verified" branch below is a second, more direct fix for the
 * same staleness (see its comment).
 */
const Profile = () => {
  const { user, logout, refreshUser } = useAuth();
  const { count: cartCount, openCart } = useCart();
  const navigate = useNavigate();

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  useEffect(() => {
    refreshUser?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleLogoutAll = async () => {
    setSigningOutAll(true);
    try {
      await logoutAllApi();
    } catch (err) {
      console.error('Failed to sign out of all devices:', err);
    } finally {
      setSigningOutAll(false);
      await logout();
      navigate('/login');
    }
  };

  const handleVerifyEmail = async () => {
    setMessage('');
    setError('');
    setSending(true);
    try {
      const res = await verifyEmail(user?.email);
      setMessage(res.message || 'Verification email sent — check your inbox.');
    } catch (err) {
      const status = err?.response?.status;
      const apiMessage = err?.response?.data?.message;
      if (status === 400 && apiMessage?.toLowerCase().includes('already verified')) {
        // The backend just told us our cached `user.is_verified` is wrong —
        // that's good news, not a failure, so fix the local state instead
        // of showing it as an error.
        refreshUser?.();
        setMessage('Your email is already verified.');
      } else {
        setError(apiMessage || 'Failed to send verification email');
      }
    } finally {
      setSending(false);
    }
  };

  const initial = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="profile-page container">
      <div className="profile-page__header">
        <span className="badge badge-secondary">Account</span>
        <h1>Your account</h1>
      </div>

      <div className="profile-page__grid">
        <section className="card profile-summary">
          <div className="profile-summary__avatar">{initial}</div>
          <div className="profile-summary__info">
            <h2>{user?.name || 'Your account'}</h2>
            <p>{user?.email}</p>

            {user?.is_verified ? (
              <span className="badge profile-summary__verified">
                <Icon name="shield" size={14} /> Email verified
              </span>
            ) : (
              <div className="profile-summary__unverified">
                <span className="badge badge-muted">Email not verified</span>
                <button
                  type="button"
                  className="profile-summary__resend"
                  onClick={handleVerifyEmail}
                  disabled={sending}
                >
                  {sending ? 'Sending…' : 'Resend verification email'}
                </button>
              </div>
            )}

            {message && <p className="form-alert form-alert-success">{message}</p>}
            {error && <p className="form-alert form-alert-error">{error}</p>}
          </div>
        </section>

        <section className="card profile-card">
          <h3>
            <Icon name="cart" size={18} /> Cart
          </h3>
          <p>
            {cartCount > 0
              ? `${cartCount} item${cartCount === 1 ? '' : 's'} waiting in your cart.`
              : "Your cart is empty right now."}
          </p>
          <Button variant="ghost" onClick={openCart}>
            View cart
          </Button>
        </section>

        <section className="card profile-card">
          <h3>
            <Icon name="truck" size={18} /> Orders
          </h3>
          <p>Track and review everything you've ordered.</p>
          <Button to="/orders" variant="ghost">
            View orders
          </Button>
        </section>

        <section className="card profile-card profile-card--wide">
          <h3>Sign out</h3>
          <p>Sign out of just this device, or everywhere you're currently logged in.</p>
          <div className="profile-card__actions">
            <Button variant="ghost" onClick={handleLogout}>
              Logout
            </Button>
            <Button variant="ghost" onClick={handleLogoutAll} disabled={signingOutAll}>
              {signingOutAll ? 'Signing out…' : 'Logout everywhere'}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Profile;
