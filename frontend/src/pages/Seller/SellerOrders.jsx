import { Fragment, useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { listSellerOrders, updateSellerOrderStatus } from '../../api/marketplace.api';
import { formatOrderDate, statusBadgeClass } from '../../utils/order';
import { getImageUrl } from '../../utils/product';
import { errorMessage, formatMoney } from '../Admin/adminUtils';

const PAGE_SIZE = 20;
const FILTERS = ['', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const ACTION_LABEL = { confirmed: 'Confirm', shipped: 'Mark shipped', delivered: 'Mark delivered' };
const EMPTY_TRACKING = { tracking_carrier: '', tracking_number: '', tracking_url: '' };

/** The seller's share of customer orders: only their items, with confirm → ship → deliver. */
const SellerOrders = () => {
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [shipping, setShipping] = useState(null);
  const [tracking, setTracking] = useState(EMPTY_TRACKING);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('loading');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filter) params.status = filter;
      if (query) params.search = query;
      const res = await listSellerOrders(params);
      setOrders(res.data.orders);
      setCounts(res.data.counts);
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

  const advance = async (order, next, extra = {}) => {
    setBusyId(order.id);
    setError('');
    try {
      await updateSellerOrderStatus(order.id, { status: next, ...extra });
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
        <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input className="input" placeholder="Order number" inputMode="numeric" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by order number" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
      </div>
      <div className="admin-filter" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f || 'all'} type="button" className={`admin-chip ${filter === f ? 'is-active' : ''}`} onClick={() => { setPage(1); setFilter(f); }}>
            {f || 'all'}{f && counts[f] ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {error && <p className="form-alert form-alert-error">{error}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 160 }} />}
      {status === 'ready' && orders.length === 0 && <p className="admin-muted">No orders here yet.</p>}

      {orders.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">Items</th>
                <th scope="col" className="is-num">You earn</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const waitingForPayment = o.order.payment_method === 'card' && o.order.payment_status === 'unpaid' && o.order.status !== 'cancelled';
                return (
                  <Fragment key={o.id}>
                    <tr className={expanded === o.id ? 'is-selected' : ''}>
                      <td>
                        <button type="button" className="admin-link" onClick={() => setExpanded(expanded === o.id ? null : o.id)} aria-expanded={expanded === o.id}>
                          #{o.order_id}
                        </button>
                        <div className="admin-muted">{o.order.user?.name ?? 'Guest'}</div>
                      </td>
                      <td>{formatOrderDate(o.created_at)}</td>
                      <td>
                        {o.items.map((i) => (
                          <div key={i.id} className="admin-table__product">
                            <span className="admin-thumb">
                              {i.product?.images?.[0] ? <img src={getImageUrl(i.product.images[0].key)} alt="" /> : <Icon name="image" size={14} />}
                            </span>
                            {i.quantity} × {i.product_name}{i.variant_name ? ` (${i.variant_name})` : ''}
                          </div>
                        ))}
                      </td>
                      <td className="is-num">
                        {formatMoney(o.seller_earnings)}
                        <div className="admin-muted">of {formatMoney(o.subtotal)}</div>
                      </td>
                      <td><span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span></td>
                      <td className="is-num admin-row-actions">
                        {o.next_statuses.map((next) => (
                          <Button
                            key={next}
                            size="sm"
                            variant="ghost"
                            disabled={busyId === o.id}
                            onClick={() => {
                              if (next === 'shipped') {
                                setTracking(EMPTY_TRACKING);
                                setShipping(shipping === o.id ? null : o.id);
                              } else advance(o, next);
                            }}
                          >
                            {ACTION_LABEL[next]}
                          </Button>
                        ))}
                        {waitingForPayment && <span className="admin-muted">Awaiting payment</span>}
                      </td>
                    </tr>
                    {shipping === o.id && (
                      <tr className="admin-table__detail">
                        <td colSpan={6}>
                          <form className="admin-order-panel__form" onSubmit={(e) => { e.preventDefault(); advance(o, 'shipped', tracking); }}>
                            <h4>Ship your items for order #{o.order_id}</h4>
                            <div className="admin-form admin-form--compact">
                              <div className="field">
                                <label htmlFor={`sc-${o.id}`}>Courier</label>
                                <input id={`sc-${o.id}`} className="input" maxLength={100} placeholder="TCS, Leopards, DHL…" value={tracking.tracking_carrier} onChange={(e) => setTracking({ ...tracking, tracking_carrier: e.target.value })} />
                              </div>
                              <div className="field">
                                <label htmlFor={`sn-${o.id}`}>Tracking number</label>
                                <input id={`sn-${o.id}`} className="input" maxLength={100} value={tracking.tracking_number} onChange={(e) => setTracking({ ...tracking, tracking_number: e.target.value })} />
                              </div>
                              <div className="field">
                                <label htmlFor={`su-${o.id}`}>Tracking link</label>
                                <input id={`su-${o.id}`} className="input" type="url" maxLength={500} placeholder="https://…" value={tracking.tracking_url} onChange={(e) => setTracking({ ...tracking, tracking_url: e.target.value })} />
                              </div>
                            </div>
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
                        <td colSpan={6}>
                          <div className="admin-order-panel__grid">
                            <section>
                              <h4>Ship to</h4>
                              <pre className="admin-address">{o.order.shipping_address}</pre>
                            </section>
                            <section>
                              <h4>Details</h4>
                              <p className="admin-muted">
                                Sale {formatMoney(o.subtotal)} · store fee {Number(o.commission_rate)}% ({formatMoney(o.commission_amount)}) · you earn {formatMoney(o.seller_earnings)}
                              </p>
                              <p className="admin-muted">Payment: {o.order.payment_method === 'cod' ? 'cash on delivery' : o.order.payment_method} · {o.order.payment_status}</p>
                              {o.tracking_number && <p className="admin-muted">Tracking: {o.tracking_carrier} {o.tracking_number}</p>}
                              {o.earnings_credited_at && <p className="admin-muted">Earnings added to your balance on {formatOrderDate(o.earnings_credited_at)}.</p>}
                            </section>
                          </div>
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

export default SellerOrders;
