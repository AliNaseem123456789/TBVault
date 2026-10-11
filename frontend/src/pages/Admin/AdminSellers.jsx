import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import {
  listSellers, getSellerAdmin, setSellerStatus, updateSellerAdmin, createSellerPayout, getSellerTransactionsAdmin,
} from '../../api/marketplace.api';
import { formatOrderDate, formatOrderDateTime } from '../../utils/order';
import { errorMessage, formatMoney } from './adminUtils';

const PAGE_SIZE = 20;
const FILTERS = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED', ''];
const STATUS_BADGE = { PENDING: '', APPROVED: 'badge-secondary', SUSPENDED: 'badge-danger', REJECTED: 'badge-muted' };
// Admin actions per status (mirrors SELLER_NEXT on the API).
const ACTIONS = {
  PENDING: [['APPROVED', 'Approve'], ['REJECTED', 'Reject']],
  APPROVED: [['SUSPENDED', 'Suspend']],
  SUSPENDED: [['APPROVED', 'Reinstate']],
  REJECTED: [['APPROVED', 'Approve']],
};
const LEDGER_LABELS = { earning: 'Earning', refund: 'Return refund', payout: 'Payout', adjustment: 'Adjustment' };

// One seller: review the application, change status, commission, payouts and ledger.
const SellerPanel = ({ sellerId, onChanged }) => {
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [note, setNote] = useState('');
  const [commission, setCommission] = useState('');
  const [payout, setPayout] = useState({ amount: '', reference: '', note: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [res, tx] = await Promise.all([getSellerAdmin(sellerId), getSellerTransactionsAdmin(sellerId, { limit: 10 })]);
    setData(res.data);
    setLedger(tx.data);
    setCommission(res.data.seller.commission_rate ?? '');
    setNote(res.data.seller.admin_note ?? '');
  }, [sellerId]);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err, 'Could not load this seller')));
  }, [load]);

  const run = async (name, fn, success) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      const res = await fn();
      const text = res?.message ?? success;
      setNotice(text);
      await load();
      // Status changes can move the seller out of the current filter, so the list shows the message too.
      onChanged(name === 'APPROVED' || name === 'REJECTED' || name === 'SUSPENDED' ? text : '');
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    } finally {
      setBusy('');
    }
  };

  if (!data) return error ? <p className="form-alert form-alert-error">{error}</p> : <div className="skeleton" style={{ height: 120 }} />;
  const { seller, money, default_commission_rate: defaultRate } = data;

  return (
    <div className="admin-order-panel">
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {notice && <p className="form-alert form-alert-success">{notice}</p>}
      <div className="admin-order-panel__grid">
        <section>
          <h4>Application</h4>
          <p><strong>{seller.store_name}</strong> · applied {formatOrderDate(seller.created_at)}</p>
          <p className="admin-muted">{seller.user ? `${seller.user.name ?? 'No name'} · ${seller.user.email}` : 'No owner'}</p>
          <p className="admin-pre">{seller.description || 'No description.'}</p>

          {ACTIONS[seller.status] && (
            <div className="admin-order-panel__form">
              <h4>Decision</h4>
              <input className="input" placeholder="Note to keep on file (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <div className="admin-form__actions">
                {ACTIONS[seller.status].map(([status, label]) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === 'APPROVED' ? 'primary' : 'ghost'}
                    className={['REJECTED', 'SUSPENDED'].includes(status) ? 'admin-danger' : ''}
                    disabled={!!busy}
                    onClick={() => {
                      if (status === 'SUSPENDED' && !window.confirm(`Suspend ${seller.store_name}? Their products disappear from the shop until reinstated.`)) return;
                      run(status, () => setSellerStatus(seller.id, status, note || undefined));
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <form
            className="admin-order-panel__form"
            onSubmit={(e) => {
              e.preventDefault();
              run('commission', () => updateSellerAdmin(seller.id, { commission_rate: commission === '' ? null : Number(commission) }), 'Commission saved');
            }}
          >
            <h4>Commission</h4>
            <div className="admin-inline-form">
              <input className="input" type="number" min="0" max="90" step="0.01" placeholder={`Store default (${defaultRate}%)`} value={commission} onChange={(e) => setCommission(e.target.value)} aria-label="Commission percent" />
              <Button type="submit" size="sm" variant="ghost" disabled={busy === 'commission'}>Save</Button>
            </div>
            <p className="admin-muted">Applies to new orders. Leave empty to use the store default.</p>
          </form>
        </section>

        <section>
          <h4>Money</h4>
          <dl className="admin-dl admin-dl--tight">
            <div><dt>Balance (owed to seller)</dt><dd><strong>{formatMoney(money.balance)}</strong></dd></div>
            <div><dt>On the way (not delivered yet)</dt><dd>{formatMoney(money.pending_earnings)}</dd></div>
            <div><dt>Paid out so far</dt><dd>{formatMoney(money.paid_out)}</dd></div>
          </dl>

          {Number(money.balance) > 0 && (
            <form
              className="admin-order-panel__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!window.confirm(`Record a payout of ${formatMoney(payout.amount)} to ${seller.store_name}? Send the money first; this only records it.`)) return;
                run('payout', () => createSellerPayout(seller.id, { amount: Number(payout.amount), reference: payout.reference || undefined, note: payout.note || undefined }), 'Payout recorded');
                setPayout({ amount: '', reference: '', note: '' });
              }}
            >
              <h4>Record a payout</h4>
              <div className="admin-inline-form admin-inline-form--wrap">
                <input className="input" type="number" min="0.01" step="0.01" max={money.balance} placeholder={`Up to ${money.balance}`} value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} aria-label="Payout amount" required />
                <input className="input" placeholder="Bank / transfer reference" maxLength={255} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} aria-label="Reference" />
                <Button type="submit" size="sm" disabled={busy === 'payout'}>Record</Button>
              </div>
            </form>
          )}

          <h4>Recent activity</h4>
          {ledger?.transactions.length ? (
            <ul className="admin-order-panel__items">
              {ledger.transactions.map((t) => (
                <li key={t.id}>
                  <span>
                    {LEDGER_LABELS[t.type] ?? t.type}
                    {t.seller_order ? ` · order #${t.seller_order.order_id}` : ''}
                    {t.payout?.reference ? ` · ${t.payout.reference}` : ''}
                    <span className="admin-muted"> · {formatOrderDateTime(t.created_at)}</span>
                  </span>
                  <span className={Number(t.amount) < 0 ? 'admin-danger' : ''}>{Number(t.amount) > 0 ? '+' : '−'}{formatMoney(Math.abs(Number(t.amount)))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-muted">Nothing yet.</p>
          )}
        </section>
      </div>
    </div>
  );
};

/** Marketplace sellers: applications, approval, suspension, commission and payouts. */
const AdminSellers = () => {
  const [sellers, setSellers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filter) params.status = filter;
      if (query) params.search = query;
      const res = await listSellers(params);
      setSellers(res.data.sellers);
      setPendingCount(res.data.pending_count);
      setMeta(res.metaData);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load sellers'));
      setStatus('error');
    }
  }, [page, filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input className="input" placeholder="Store name or owner email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sellers" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
      </div>
      <div className="admin-filter" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f || 'all'} type="button" className={`admin-chip ${filter === f ? 'is-active' : ''}`} onClick={() => { setPage(1); setFilter(f); setExpanded(null); setNotice(''); }}>
            {f ? f.toLowerCase() : 'all'}{f === 'PENDING' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {error && <p className="form-alert form-alert-error">{error}</p>}
      {notice && <p className="form-alert form-alert-success">{notice}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 160 }} />}
      {status === 'ready' && sellers.length === 0 && (
        <p className="admin-muted">{filter === 'PENDING' ? 'No applications waiting.' : 'No sellers here.'}</p>
      )}

      {sellers.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Store</th>
                <th scope="col">Owner</th>
                <th scope="col">Status</th>
                <th scope="col" className="is-num">Products</th>
                <th scope="col" className="is-num">Orders</th>
                <th scope="col" className="is-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <Fragment key={s.id}>
                  <tr className={expanded === s.id ? 'is-selected' : ''}>
                    <td>
                      <button type="button" className="admin-link" onClick={() => setExpanded(expanded === s.id ? null : s.id)} aria-expanded={expanded === s.id}>
                        {s.store_name}
                      </button>
                      {s.is_platform ? <span className="badge badge-muted"> store</span> : s.status === 'APPROVED' && (
                        <div><Link to={`/stores/${s.slug}`} className="admin-muted">View store</Link></div>
                      )}
                    </td>
                    <td className="admin-muted">{s.user?.email ?? '—'}</td>
                    <td><span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status.toLowerCase()}</span></td>
                    <td className="is-num">{s._count.products}</td>
                    <td className="is-num">{s._count.seller_orders}</td>
                    <td className="is-num">{s.is_platform ? '—' : formatMoney(s.balance)}</td>
                  </tr>
                  {expanded === s.id && !s.is_platform && (
                    <tr className="admin-table__detail"><td colSpan={6}><SellerPanel sellerId={s.id} onChanged={(text) => { if (text) setNotice(text); load(); }} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="admin-pager">
          <Button variant="ghost" size="sm" disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {meta.currentPage} of {meta.totalPages}</span>
          <Button variant="ghost" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default AdminSellers;
