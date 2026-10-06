import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useCart } from '../cart/CartProvider';
import { verifyEmail, logoutAll as logoutAllApi, updateMe, changePassword } from '../../api/auth.api';
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
  const { user, logout, refreshUser, setToken, isAdmin } = useAuth();
  const { count: cartCount, openCart } = useCart();
  const navigate = useNavigate();

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  // Edit name
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [nameStatus, setNameStatus] = useState({ saving: false, error: '' });

  // Change password
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwStatus, setPwStatus] = useState({ saving: false, error: '', message: '' });

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
      const res = await verifyEmail();
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

  const startEditingName = () => {
    setName(user?.name || '');
    setNameStatus({ saving: false, error: '' });
    setEditingName(true);
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    setNameStatus({ saving: true, error: '' });
    try {
      await updateMe({ name });
      await refreshUser?.();
      setEditingName(false);
      setNameStatus({ saving: false, error: '' });
    } catch (err) {
      setNameStatus({ saving: false, error: err?.response?.data?.message || 'Could not update your name' });
    }
  };

  const updatePw = (field) => (e) => setPw((p) => ({ ...p, [field]: e.target.value }));

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirmPassword) {
      setPwStatus({ saving: false, error: 'New passwords do not match', message: '' });
      return;
    }
    setPwStatus({ saving: true, error: '', message: '' });
    try {
      const res = await changePassword(pw);
      // The backend signed out every other session and issued this one a new token.
      await setToken(res.data.accessToken);
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwStatus({ saving: false, error: '', message: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setPwStatus({ saving: false, error: err?.response?.data?.message || 'Could not change your password', message: '' });
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
            {editingName ? (
              <form className="profile-name-form" onSubmit={handleSaveName}>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                  aria-label="Your name"
                  autoFocus
                  required
                />
                <Button type="submit" size="sm" disabled={nameStatus.saving}>
                  {nameStatus.saving ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <h2>
                {user?.name || 'Your account'}{' '}
                <button type="button" className="profile-summary__edit" onClick={startEditingName}>
                  Edit name
                </button>
              </h2>
            )}
            {nameStatus.error && <p className="form-alert form-alert-error">{nameStatus.error}</p>}
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

        {isAdmin && (
          <section className="card profile-card">
            <h3>
              <Icon name="shield" size={18} /> Admin
            </h3>
            <p>Manage products, categories and orders.</p>
            <Button to="/admin" variant="ghost">
              Open dashboard
            </Button>
          </section>
        )}

        <section className="card profile-card profile-card--wide">
          <h3>Password</h3>
          {user?.has_password === false ? (
            <p>
              You sign in with Google, so this account has no password. To add one, use{' '}
              <a href="/forgot-password">Forgot password</a> with {user?.email}.
            </p>
          ) : (
            <form className="profile-password-form" onSubmit={handleChangePassword}>
              <div className="field">
                <label htmlFor="pw-current">Current password</label>
                <input id="pw-current" type="password" className="input" autoComplete="current-password"
                  value={pw.currentPassword} onChange={updatePw('currentPassword')} required />
              </div>
              <div className="field">
                <label htmlFor="pw-new">New password</label>
                <input id="pw-new" type="password" className="input" autoComplete="new-password" minLength={8}
                  value={pw.newPassword} onChange={updatePw('newPassword')} required />
              </div>
              <div className="field">
                <label htmlFor="pw-confirm">Confirm new password</label>
                <input id="pw-confirm" type="password" className="input" autoComplete="new-password" minLength={8}
                  value={pw.confirmPassword} onChange={updatePw('confirmPassword')} required />
              </div>
              {pwStatus.error && <p className="form-alert form-alert-error">{pwStatus.error}</p>}
              {pwStatus.message && <p className="form-alert form-alert-success">{pwStatus.message}</p>}
              <div>
                <Button type="submit" disabled={pwStatus.saving}>
                  {pwStatus.saving ? 'Saving…' : 'Change password'}
                </Button>
              </div>
            </form>
          )}
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
