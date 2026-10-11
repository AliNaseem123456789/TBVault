import { Fragment, useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { listOrders, getOrder, changeOrderStatus, updateOrderTracking, refundOrder, downloadExport } from '../../api/admin.api';
import { statusBadgeClass, formatOrderDate, formatOrderDateTime, NEXT_STATUSES, ORDER_STATUSES, paymentLabel, paymentMethodLabel, STATUS_TEXT } from '../../utils/order';
import { errorMessage, formatMoney } from './adminUtils';

const PAGE_SIZE = 20;
const ACTION_LABEL = { confirmed: 'Confirm', shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel' };
const EMPTY_TRACKING = { tracking_carrier: '', tracking_number: '', tracking_url: '' };

const TrackingFields = ({ value, onChange, idPrefix }) => (
  <div className="admin-form admin-form--compact">
    <div className="field">
      <label htmlFor={`${idPrefix}-carrier`}>Courier</label>
      <input id={`${idPrefix}-carrier`} className="input" placeholder="TCS, Leopards, DHL…" maxLength={100} value={value.tracking_carrier} onChange={(e) => onChange({ ...value, tracking_carrier: e.target.value })} />
    </div>
    <div className="field">
      <label htmlFor={`${idPrefix}-number`}>Tracking number</label>
      <input id={`${idPrefix}-number`} className="input" maxLength={100} value={value.tracking_number} onChange={(e) => onChange({ ...value, tracking_number: e.target.value })} />
    </div>
    <div className="field">
      <label htmlFor={`${idPrefix}-url`}>Tracking link</label>
      <input id={`${idPrefix}-url`} className="input" type="url" placeholder="https://…" maxLength={500} value={value.tracking_url} onChange={(e) => onChange({ ...value, tracking_url: e.target.value })} />
    </div>
  </div>
);

// Everything about one order, loaded when its row is expanded.
const OrderPanel = ({ orderId, onChanged }) => {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [tracking, setTracking] = useState(EMPTY_TRACKING);
  const [refund, setRefund] = useState({ amount: '', reason: '', destination: 'original' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getOrder(orderId);
      const o = res.data.order;
      setOrder(o);
      setTracking({ tracking_carrier: o.tracking_carrier ?? '', tracking_number: o.tracking_number ?? '', tracking_url: o.tracking_url ?? '' });
    } catch (err) {
      setError(errorMessage(err, 'Could not load this order'));
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (name, fn, success) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(success);
      await load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    } finally {
      setBusy('');
    }
  };

  if (!order) return error ? <p className="form-alert form-alert-error">{error}</p> : <div className="skeleton" style={{ height: 120 }} />;

  const refundable = Number(order.total_amount) - Number(order.amount_refunded);
  const canRefund = ['paid', 'partially_refunded'].includes(order.payment_status) && refundable > 0;

  return (
    <div className="admin-order-panel">
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {notice && <p className="form-alert form-alert-success">{notice}</p>}

      <div className="admin-order-panel__grid">
        <section>
          <h4>Items</h4>
          <ul className="admin-order-panel__items">
            {order.items.map((item) => (
              <li key={item.id}>
                <span>{item.quantity} × {item.product_name ?? item.product?.name ?? `Product #${item.product_id}`}{item.variant_name ? ` (${item.variant_name})` : ''}</span>
                <span>{formatMoney(item.total_price)}</span>
              </li>
            ))}
          </ul>
          <dl className="admin-dl admin-dl--tight">
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd></div>
            {Number(order.discount_total) > 0 && <div><dt>Discount {order.coupon_code && `(${order.coupon_code})`}</dt><dd>−{formatMoney(order.discount_total)}</dd></div>}
            <div><dt>Shipping</dt><dd>{formatMoney(order.shipping_total)}</dd></div>
            {Number(order.tax_total) > 0 && <div><dt>Tax</dt><dd>{formatMoney(order.tax_total)}</dd></div>}
            <div><dt><strong>Total</strong></dt><dd><strong>{formatMoney(order.total_amount)}</strong></dd></div>
            {Number(order.credits_applied) > 0 && <div><dt>Paid with store credit</dt><dd>{formatMoney(order.credits_applied)}</dd></div>}
            {Number(order.amount_refunded) > 0 && <div><dt>Refunded</dt><dd>−{formatMoney(order.amount_refunded)}</dd></div>}
          </dl>
          {order.seller_orders?.length > 0 && (
            <>
              <h4>Sellers</h4>
              <ul className="admin-order-panel__items">
                {order.seller_orders.map((so) => (
                  <li key={so.id}>
                    <span>
                      {so.seller?.is_platform ? 'Store' : so.seller?.store_name} · <span className={`badge ${statusBadgeClass(so.status)}`}>{so.status}</span>
                      {so.tracking_number && <span className="admin-muted"> · {so.tracking_carrier} {so.tracking_number}</span>}
                    </span>
                    <span className="admin-muted">
                      {formatMoney(so.subtotal)}
                      {!so.seller?.is_platform && ` · ${Number(so.commission_rate)}% fee · earns ${formatMoney(so.seller_earnings)}${so.earnings_credited_at ? ' ✓' : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Ship to</h4>
          <pre className="admin-address">{order.shipping_address}</pre>
        </section>

        <section>
          <h4>Timeline</h4>
          <ol className="admin-history">
            {order.status_history.map((h) => (
              <li key={h.id}>
                <span className="admin-history__what">{STATUS_TEXT[h.to_status] ?? h.to_status}{h.from_status === h.to_status ? ' (note)' : ''}</span>
                <span className="admin-muted">{formatOrderDateTime(h.created_at)} · {h.actor_type}</span>
                {h.note && <span className="admin-history__note">{h.note}</span>}
              </li>
            ))}
          </ol>

          {['shipped', 'delivered'].includes(order.status) && (
            <form
              className="admin-order-panel__form"
              onSubmit={(e) => {
                e.preventDefault();
                run('tracking', () => updateOrderTracking(order.id, tracking), 'Tracking updated');
              }}
            >
              <h4>Tracking</h4>
              <TrackingFields value={tracking} onChange={setTracking} idPrefix={`trk-${order.id}`} />
              <Button type="submit" size="sm" variant="ghost" disabled={busy === 'tracking'}>Save tracking</Button>
            </form>
          )}

          <div className="admin-order-panel__form">
            <h4>Payment</h4>
            <p className="admin-muted">
              {paymentMethodLabel(order)} · {paymentLabel(order)}
              {order.paid_at && ` · paid ${formatOrderDate(order.paid_at)}`}
            </p>
            {order.refunds.map((r) => (
              <p key={r.id} className="admin-muted">
                Refund {formatMoney(r.amount)} · {r.method} · {r.status} · {formatOrderDate(r.created_at)}{r.reason ? ` · ${r.reason}` : ''}
              </p>
            ))}
            {canRefund && (
              <form
                className="admin-inline-form admin-inline-form--wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  const amount = refund.amount === '' ? undefined : Number(refund.amount);
                  const label = formatMoney(amount ?? refundable);
                  const where = refund.destination === 'credits' ? ' to the customer\'s store credit' : order.payment_method === 'card' ? ' to the original payment' : ' (record a cash refund)';
                  if (!window.confirm(`Refund ${label}${where}?`)) return;
                  run('refund', () => refundOrder(order.id, { amount, reason: refund.reason || undefined, destination: refund.destination }), 'Refund issued');
                  setRefund({ amount: '', reason: '', destination: 'original' });
                }}
              >
                <input className="input" type="number" min="0.01" step="0.01" max={refundable} placeholder={`Up to ${refundable.toFixed(2)}`} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} aria-label="Refund amount" />
                <input className="input" placeholder="Reason (optional)" maxLength={500} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} aria-label="Refund reason" />
                {order.user_id && (
                  <select className="input" value={refund.destination} onChange={(e) => setRefund({ ...refund, destination: e.target.value })} aria-label="Refund to">
                    <option value="original">To original payment</option>
                    <option value="credits">To store credit</option>
                  </select>
                )}
                <Button type="submit" size="sm" variant="ghost" className="admin-danger" disabled={busy === 'refund'}>
                  {busy === 'refund' ? 'Refunding…' : refund.amount ? 'Refund' : 'Refund all'}
                </Button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const AdminOrders = () => {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [shipping, setShipping] = useState(null); // order id whose "ship" form is open
  const [shipTracking, setShipTracking] = useState(EMPTY_TRACKING);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filter) params.status = filter;
      if (query) params.search = query;
      const res = await listOrders(params);
      setOrders(res.data.orders);
      setMeta(res.metaData);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load orders'));
      setStatus('error');
    }
  }, [page, filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (order, next, extra = {}) => {
    if (next === 'cancelled' && !window.confirm(`Cancel order #${order.id}? Its stock will be returned.`)) return;
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      const res = await changeOrderStatus(order.id, { status: next, ...extra });
      if (res.data?.refund_due) setNotice(res.message);
      setShipping(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not update the order'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <form
          className="admin-search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <input className="input" placeholder="Order #, customer name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
        <Button variant="ghost" size="sm" onClick={() => downloadExport('orders', filter ? { status: filter } : {}).catch((err) => setError(errorMessage(err, 'Export failed')))}>
          <Icon name="download" size={16} /> Export CSV
        </Button>
      </div>
      <div className="admin-filter" role="group" aria-label="Filter by status">
        {['', ...ORDER_STATUSES].map((s) => (
          <button key={s || 'all'} type="button" className={`admin-chip ${filter === s ? 'is-active' : ''}`} onClick={() => { setPage(1); setFilter(s); }}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && <p className="form-alert form-alert-error">{error}</p>}
      {notice && <p className="form-alert form-alert-success">{notice}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 200 }} />}
      {status === 'ready' && orders.length === 0 && <p className="admin-muted">No orders here.</p>}

      {orders.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Date</th>
                <th scope="col" className="is-num">Total</th>
                <th scope="col">Payment</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const unpaidCard = o.payment_method === 'card' && o.payment_status === 'unpaid';
                return (
                  <Fragment key={o.id}>
                    <tr className={expanded === o.id ? 'is-selected' : ''}>
                      <td>
                        <button type="button" className="admin-link" onClick={() => setExpanded(expanded === o.id ? null : o.id)} aria-expanded={expanded === o.id}>
                          #{o.id}
                        </button>
                      </td>
                      <td>
                        <div>{o.user?.name || (o.user_id ? '—' : 'Guest')}</div>
                        <div className="admin-muted">{o.user?.email ?? o.guest_email}</div>
                        {o.seller_orders?.some((so) => !so.seller?.is_platform) && (
                          <div className="admin-muted">Sellers: {o.seller_orders.map((so) => (so.seller?.is_platform ? 'Store' : so.seller?.store_name)).join(', ')}</div>
                        )}
                      </td>
                      <td>{formatOrderDate(o.created_at)}</td>
                      <td className="is-num">{formatMoney(o.total_amount)}</td>
                      <td>
                        <span className="admin-muted">{paymentMethodLabel(o)}</span>
                        <div className={o.payment_status === 'unpaid' && o.payment_method === 'card' ? 'admin-danger' : ''}>{paymentLabel(o)}</div>
                      </td>
                      <td><span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span></td>
                      <td className="is-num admin-row-actions">
                        {(NEXT_STATUSES[o.status] ?? [])
                          .filter((next) => !(unpaidCard && next !== 'cancelled'))
                          .map((next) => (
                            <Button
                              key={next}
                              variant="ghost"
                              size="sm"
                              className={next === 'cancelled' ? 'admin-danger' : ''}
                              disabled={busyId === o.id}
                              onClick={() => {
                                if (next === 'shipped') {
                                  setShipTracking(EMPTY_TRACKING);
                                  setShipping(shipping === o.id ? null : o.id);
                                } else changeStatus(o, next);
                              }}
                            >
                              {ACTION_LABEL[next]}
                            </Button>
                          ))}
                        {unpaidCard && o.status === 'pending' && <span className="admin-muted">Awaiting payment</span>}
                      </td>
                    </tr>
                    {shipping === o.id && (
                      <tr className="admin-table__detail">
                        <td colSpan={7}>
                          <form
                            className="admin-order-panel__form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              changeStatus(o, 'shipped', shipTracking);
                            }}
                          >
                            <h4>Ship order #{o.id}</h4>
                            <p className="admin-muted">Tracking details are emailed to the customer and shown on their order page. All optional.</p>
                            <TrackingFields value={shipTracking} onChange={setShipTracking} idPrefix={`ship-${o.id}`} />
                            <div className="admin-form__actions">
                              <Button type="submit" size="sm" disabled={busyId === o.id}>Mark shipped</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setShipping(null)}>Cancel</Button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                    {expanded === o.id && (
                      <tr className="admin-table__detail">
                        <td colSpan={7}>
                          <OrderPanel orderId={o.id} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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

export default AdminOrders;
