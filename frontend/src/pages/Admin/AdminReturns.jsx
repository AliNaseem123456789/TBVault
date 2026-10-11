import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { listReturns, updateReturn, refundReturn } from '../../api/admin.api';
import { errorMessage, formatMoney } from './adminUtils';
import { formatOrderDate } from '../../utils/order';

const STATUSES = ['REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED'];
const BADGE = { REQUESTED: '', APPROVED: 'badge-secondary', RECEIVED: 'badge-secondary', REFUNDED: 'badge-muted', REJECTED: 'badge-danger' };

const ReturnCard = ({ r, onChanged }) => {
  const [note, setNote] = useState(r.admin_note ?? '');
  const [amount, setAmount] = useState(r.suggested_refund);
  const [restock, setRestock] = useState(true);
  const [destination, setDestination] = useState('original');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const act = async (name, fn) => {
    setBusy(name);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    } finally {
      setBusy('');
    }
  };
  const customer = r.order.user?.email ?? r.order.guest_email;

  return (
    <li className="card admin-return">
      <div className="admin-return__head">
        <div>
          <strong>Return #{r.id}</strong> · Order #{r.order.id} · {customer}
          <div className="admin-muted">{formatOrderDate(r.created_at)} · {r.order.payment_method === 'card' ? 'Card' : 'Cash on delivery'}</div>
        </div>
        <span className={`badge ${BADGE[r.status]}`}>{r.status.toLowerCase()}</span>
      </div>
      <ul className="admin-return__items">
        {r.items.map((ri) => (
          <li key={ri.id}>{ri.quantity} × {ri.order_item.product_name}{ri.order_item.variant_name ? ` (${ri.order_item.variant_name})` : ''} · {formatMoney(ri.order_item.unit_price)} each</li>
        ))}
      </ul>
      <p className="admin-return__reason">“{r.reason}”</p>
      {r.refund_amount && <p className="admin-muted">Refunded {formatMoney(r.refund_amount)}</p>}
      {error && <p className="form-alert form-alert-error">{error}</p>}

      {['REQUESTED', 'APPROVED', 'RECEIVED'].includes(r.status) && (
        <div className="admin-return__actions">
          {r.status !== 'RECEIVED' && (
            <input className="input" placeholder="Note to the customer (optional)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note to the customer" />
          )}
          <div className="admin-row-actions">
            {r.status === 'REQUESTED' && (
              <Button size="sm" disabled={!!busy} onClick={() => act('approve', () => updateReturn(r.id, { status: 'APPROVED', admin_note: note }))}>Approve</Button>
            )}
            {r.status === 'APPROVED' && (
              <>
                <label className="admin-form__checkbox admin-return__restock">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put back in stock
                </label>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('receive', () => updateReturn(r.id, { status: 'RECEIVED', restock, admin_note: note || undefined }))}>Mark received</Button>
              </>
            )}
            {r.status !== 'RECEIVED' && (
              <Button size="sm" variant="ghost" className="admin-danger" disabled={!!busy} onClick={() => act('reject', () => updateReturn(r.id, { status: 'REJECTED', admin_note: note }))}>Reject</Button>
            )}
          </div>
          {['APPROVED', 'RECEIVED'].includes(r.status) && (
            <form
              className="admin-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (window.confirm(`Refund ${formatMoney(amount)} for return #${r.id}${destination === 'credits' ? ' to store credit' : ''}?`)) act('refund', () => refundReturn(r.id, Number(amount), destination));
              }}
            >
              <label htmlFor={`ret-amt-${r.id}`} className="admin-muted">Refund $</label>
              <input id={`ret-amt-${r.id}`} className="input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {r.order.user && (
                <select className="input" value={destination} onChange={(e) => setDestination(e.target.value)} aria-label="Refund to">
                  <option value="original">To original payment</option>
                  <option value="credits">To store credit</option>
                </select>
              )}
              <Button type="submit" size="sm" disabled={!!busy}>{busy === 'refund' ? 'Refunding…' : 'Refund'}</Button>
            </form>
          )}
          {['APPROVED', 'RECEIVED'].includes(r.status) && (
            <p className="admin-muted">Suggested: {formatMoney(r.suggested_refund)} (items after discount, plus their tax; shipping isn't refunded).</p>
          )}
        </div>
      )}
    </li>
  );
};

/** Return requests: approve or reject, mark received (restock), refund. */
const AdminReturns = () => {
  const [returns, setReturns] = useState([]);
  const [filter, setFilter] = useState('REQUESTED');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listReturns(filter ? { status: filter } : {});
      setReturns(res.data.returns);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load returns'));
      setStatus('error');
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-panel">
      <div className="admin-filter" role="group" aria-label="Filter by status">
        {[...STATUSES, ''].map((s) => (
          <button key={s || 'all'} type="button" className={`admin-chip ${filter === s ? 'is-active' : ''}`} onClick={() => setFilter(s)}>
            {s ? s.toLowerCase() : 'All'}
          </button>
        ))}
      </div>
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 160 }} />}
      {status === 'ready' && returns.length === 0 && <p className="admin-muted">No returns here.</p>}
      <ul className="admin-returns">
        {returns.map((r) => <ReturnCard key={`${r.id}-${r.updated_at}`} r={r} onChanged={load} />)}
      </ul>
    </div>
  );
};

export default AdminReturns;
