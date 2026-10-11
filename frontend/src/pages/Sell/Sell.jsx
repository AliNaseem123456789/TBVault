import { useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { useAuth } from '../../features/auth/AuthProvider';
import { applyToSell, getMySeller } from '../../api/marketplace.api';
import './Sell.css';

const STEPS = [
  ['store', 'Apply', 'Tell us your store name and what you sell.'],
  ['check', 'Get approved', 'We review every store, usually within a day or two.'],
  ['tag', 'List products', 'Add products, photos and options from your seller dashboard.'],
  ['truck', 'Ship & get paid', "Ship your orders. Earnings reach your balance once they're delivered."],
];

const STATUS_COPY = {
  PENDING: { title: 'Application received', text: "We're reviewing your store. You'll see the result here." },
  REJECTED: { title: "Your application wasn't approved", text: 'You can update it and apply again.' },
  SUSPENDED: { title: 'Your store is suspended', text: 'Your products are hidden from the shop. Contact us to sort it out.' },
};

/** /sell — how selling works, the application form, and the application's status. */
const Sell = () => {
  const { isAuthenticated, isSeller, refreshUser } = useAuth();
  const [seller, setSeller] = useState(undefined);
  const [form, setForm] = useState({ store_name: '', description: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    getMySeller()
      .then((res) => {
        setSeller(res.data.seller);
        if (res.data.seller) setForm({ store_name: res.data.seller.store_name, description: res.data.seller.description ?? '' });
      })
      .catch(() => setSeller(null));
  }, [isAuthenticated]);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await applyToSell({ store_name: form.store_name, description: form.description || undefined });
      setSeller(res.data.seller);
      refreshUser?.();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not send your application');
    } finally {
      setSending(false);
    }
  };

  const canApply = isAuthenticated && seller !== undefined && (!seller || seller.status === 'REJECTED');
  const copy = seller && STATUS_COPY[seller.status];

  return (
    <div className="sell-page container">
      <div className="section-heading">
        <span className="badge">Marketplace</span>
        <h2>Sell on TBVault.</h2>
        <p className="sell-page__lead">Open your own store, reach our customers, and let us handle checkout and payments.</p>
      </div>

      <ol className="sell-steps">
        {STEPS.map(([icon, title, text]) => (
          <li key={title} className="card sell-step">
            <Icon name={icon} size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>

      <section className="card sell-panel">
        {!isAuthenticated && (
          <>
            <h3>Start with a TBVault account</h3>
            <p>Log in or sign up, then come back here to apply.</p>
            <div className="sell-panel__actions">
              <Button to="/login">Log in</Button>
              <Button to="/sign-up" variant="ghost">Sign up</Button>
            </div>
          </>
        )}

        {isAuthenticated && seller === undefined && <div className="skeleton" style={{ height: 120 }} />}

        {isSeller && (
          <>
            <h3>Your store is open</h3>
            <p>Manage products, orders and earnings from your dashboard.</p>
            <Button to="/seller">Go to seller dashboard</Button>
          </>
        )}

        {copy && (
          <div className={`form-alert ${seller.status === 'PENDING' ? 'form-alert-success' : 'form-alert-error'}`}>
            <strong>{copy.title}</strong> {copy.text}
            {seller.admin_note && <p className="sell-panel__note">Note from the team: “{seller.admin_note}”</p>}
          </div>
        )}

        {canApply && (
          <form className="sell-form" onSubmit={submit}>
            <h3>{seller ? 'Apply again' : 'Apply to sell'}</h3>
            <div className="field">
              <label htmlFor="sell-name">Store name</label>
              <input id="sell-name" className="input" minLength={2} maxLength={100} value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="sell-desc">What do you sell?</label>
              <textarea id="sell-desc" className="input" rows={4} maxLength={2000} placeholder="Your products, where they come from, anything that helps us review." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {error && <p className="form-alert form-alert-error">{error}</p>}
            <Button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send application'}</Button>
          </form>
        )}
      </section>
    </div>
  );
};

export default Sell;
