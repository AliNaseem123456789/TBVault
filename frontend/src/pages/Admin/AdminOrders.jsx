import { Fragment, useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { listOrders, updateOrderStatus } from '../../api/admin.api';
import { statusBadgeClass, formatOrderDate, NEXT_STATUSES, ORDER_STATUSES } from '../../utils/order';
import { errorMessage, formatMoney } from './adminUtils';

const PAGE_SIZE = 20;
const ACTION_LABEL = { confirmed: 'Confirm', shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel' };

const AdminOrders = () => {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filter) params.status = filter;
      const res = await listOrders(params);
      setOrders(res.data.orders);
      setMeta(res.metaData);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load orders'));
      setStatus('error');
    }
  }, [page, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (order, next) => {
    if (next === 'cancelled' && !window.confirm(`Cancel order #${order.id}? Its stock will be returned.`)) return;
    setBusyId(order.id);
    setError('');
    try {
      await updateOrderStatus(order.id, next);
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
        <div className="admin-filter" role="group" aria-label="Filter by status">
          {['', ...ORDER_STATUSES].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              className={`admin-chip ${filter === s ? 'is-active' : ''}`}
              onClick={() => { setPage(1); setFilter(s); }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-alert form-alert-error">{error}</p>}
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
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td>
                      <button type="button" className="admin-link" onClick={() => setExpanded(expanded === o.id ? null : o.id)} aria-expanded={expanded === o.id}>
                        #{o.id}
                      </button>
                    </td>
                    <td>
                      <div>{o.user?.name || '—'}</div>
                      <div className="admin-muted">{o.user?.email}</div>
                    </td>
                    <td>{formatOrderDate(o.created_at)}</td>
                    <td className="is-num">{formatMoney(o.total_amount)}</td>
                    <td><span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span></td>
                    <td className="is-num admin-row-actions">
                      {(NEXT_STATUSES[o.status] ?? []).map((next) => (
                        <Button
                          key={next}
                          variant="ghost"
                          size="sm"
                          className={next === 'cancelled' ? 'admin-danger' : ''}
                          disabled={busyId === o.id}
                          onClick={() => changeStatus(o, next)}
                        >
                          {ACTION_LABEL[next]}
                        </Button>
                      ))}
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr className="admin-table__detail">
                      <td colSpan={6}>
                        <ul>
                          {o.items.map((item) => (
                            <li key={item.id}>
                              {item.quantity} × {item.product?.name ?? `Product #${item.product_id}`} — {formatMoney(item.total_price)}
                            </li>
                          ))}
                        </ul>
                        {o.shipping_address && <pre className="admin-address">{o.shipping_address}</pre>}
                      </td>
                    </tr>
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

export default AdminOrders;
