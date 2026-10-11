import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { getWallet, startTopup, redeemGiftCard } from '../../api/wallet.api';
import { useAuth } from '../../features/auth/AuthProvider';
import { formatMoney } from '../../utils/money';
import { formatOrderDateTime } from '../../utils/order';
import { CREDIT_TYPE_LABELS } from '../../utils/wallet';
import './Wallet.css';

const QUICK_AMOUNTS = [10, 25, 50, 100];
const message = (err, fallback) => err?.response?.data?.message || fallback;

/** /wallet — store credit: balance, add by card, redeem a gift card, history. */
const Wallet = () => {
  const { refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const topupResult = searchParams.get('topup');
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [amount, setAmount] = useState('25');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const res = await getWallet({ page, limit: 15 });
    setData(res.data);
    setMeta(res.metaData);
  }, [page]);

  useEffect(() => {
    load().catch((err) => setError(message(err, 'Could not load your store credit')));
  }, [load]);

  // Back from Stripe: the credit arrives by webhook a moment later, so check again shortly.
  useEffect(() => {
    if (topupResult !== 'success') return;
    const timer = setTimeout(() => {
      load().catch(() => {});
      refreshUser?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [topupResult, load, refreshUser]);

  const topUp = async (e) => {
    e.preventDefault();
    setBusy('topup');
    setError('');
    try {
      const res = await startTopup(Number(amount));
      window.location.assign(res.data.checkout_url);
    } catch (err) {
      setError(message(err, 'Could not start the payment'));
      setBusy('');
    }
  };

  const redeem = async (e) => {
    e.preventDefault();
    setBusy('redeem');
    setError('');
    setNotice('');
    try {
      const res = await redeemGiftCard(code);
      setNotice(res.message);
      setCode('');
      setPage(1);
      await load();
      refreshUser?.();
    } catch (err) {
      setError(message(err, 'Could not redeem that code'));
    } finally {
      setBusy('');
    }
  };

  if (!data) {
    return (
      <div className="wallet-page container">
        {error ? <p className="form-alert form-alert-error">{error}</p> : <div className="skeleton" style={{ height: 260 }} />}
      </div>
    );
  }

  return (
    <div className="wallet-page container">
      <div className="section-heading">
        <span className="badge">Store credit</span>
        <h2>Your wallet.</h2>
      </div>

      {topupResult === 'success' && <p className="form-alert form-alert-success">Thanks! Your credit is being added — it shows here in a moment.</p>}
      {topupResult === 'cancelled' && <p className="form-alert form-alert-error">The payment wasn't completed, so nothing was added.</p>}
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {notice && <p className="form-alert form-alert-success">{notice}</p>}

      <div className="wallet-grid">
        <section className="card wallet-balance">
          <span className="wallet-balance__label"><Icon name="wallet" size={18} /> Balance</span>
          <span className="wallet-balance__value">{formatMoney(data.balance)}</span>
          <p>Use it at checkout — tick “Use store credit”. Refunds can come back here too.</p>
        </section>

        <section className="card wallet-box">
          <h3><Icon name="card" size={18} /> Add credit</h3>
          {data.topup.enabled ? (
            <form onSubmit={topUp} className="wallet-form">
              <div className="wallet-quick" role="group" aria-label="Quick amounts">
                {QUICK_AMOUNTS.map((n) => (
                  <button key={n} type="button" className={`admin-chip ${Number(amount) === n ? 'is-active' : ''}`} onClick={() => setAmount(String(n))}>
                    ${n}
                  </button>
                ))}
              </div>
              <div className="wallet-inline">
                <input className="input" type="number" min={data.topup.min} max={data.topup.max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to add" required />
                <Button type="submit" disabled={busy === 'topup'}>{busy === 'topup' ? 'Opening payment…' : 'Pay by card'}</Button>
              </div>
              <p className="wallet-hint">{formatMoney(data.topup.min)} – {formatMoney(data.topup.max)} per top-up.</p>
            </form>
          ) : (
            <p className="wallet-hint">Card payments aren't available right now.</p>
          )}
        </section>

        <section className="card wallet-box">
          <h3><Icon name="gift" size={18} /> Redeem a gift card</h3>
          <form onSubmit={redeem} className="wallet-inline">
            <input className="input" placeholder="TBV-XXXX-XXXX-XXXX" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Gift card code" autoComplete="off" required />
            <Button type="submit" variant="ghost" disabled={busy === 'redeem'}>{busy === 'redeem' ? 'Checking…' : 'Redeem'}</Button>
          </form>
        </section>
      </div>

      <section className="card wallet-history">
        <h3>History</h3>
        {data.transactions.length === 0 ? (
          <p className="wallet-hint">No activity yet.</p>
        ) : (
          <ul>
            {data.transactions.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{CREDIT_TYPE_LABELS[t.type] ?? t.type}</strong>
                  {t.note && <span className="wallet-hint"> · {t.note}</span>}
                  <div className="wallet-hint">{formatOrderDateTime(t.created_at)}</div>
                </div>
                <div className="wallet-history__amount">
                  <span className={Number(t.amount) < 0 ? 'is-negative' : 'is-positive'}>{Number(t.amount) > 0 ? '+' : '−'}{formatMoney(Math.abs(Number(t.amount)))}</span>
                  <span className="wallet-hint">Balance {formatMoney(t.balance_after)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="wallet-pager">
            <Button variant="ghost" size="sm" disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <span>Page {meta.currentPage} of {meta.totalPages}</span>
            <Button variant="ghost" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        )}
      </section>
    </div>
  );
};

export default Wallet;
