import { Fragment, useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { listCustomers, getCustomer, setCustomerBlocked } from '../../api/admin.api';
import { errorMessage, formatMoney } from './adminUtils';
import { formatOrderDate, statusBadgeClass, paymentLabel } from '../../utils/order';

const PAGE_SIZE = 20;

const CustomerPanel = ({ userId }) => {
  const [customer, setCustomer] = useState(null);
  useEffect(() => {
    getCustomer(userId).then((res) => setCustomer(res.data.customer)).catch(() => setCustomer(false));
  }, [userId]);
  if (customer === null) return <div className="skeleton" style={{ height: 100 }} />;
  if (customer === false) return <p className="admin-muted">Couldn't load this customer.</p>;
  return (
    <div className="admin-order-panel__grid">
      <section>
        <h4>Orders ({customer.order_count})</h4>
        {customer.orders.length === 0 ? <p className="admin-muted">No orders.</p> : (
          <ul className="admin-order-panel__items">
            {customer.orders.map((o) => (
              <li key={o.id}>
                <span>#{o.id} · {formatOrderDate(o.created_at)} · <span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span> · {paymentLabel(o)}</span>
                <span>{formatMoney(o.total_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>Addresses</h4>
        {customer.addresses.length === 0 ? <p className="admin-muted">None saved.</p> : customer.addresses.map((a) => (
          <p key={a.id} className="admin-muted">{a.full_name}, {a.line1}, {a.city}, {a.country} · {a.phone}{a.is_default ? ' (default)' : ''}</p>
        ))}
        <h4>Activity</h4>
        <p className="admin-muted">{customer._count.reviews} reviews · {customer._count.return_requests} returns · joined {formatOrderDate(customer.created_at)}</p>
      </section>
    </div>
  );
};

/** Customer list with spend, order history and blocking. */
const AdminCustomers = () => {
  const [customers, setCustomers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (query) params.search = query;
      if (blockedOnly) params.blocked = 'true';
      const res = await listCustomers(params);
      setCustomers(res.data.customers);
      setMeta(res.metaData);
    } catch (err) {
      setError(errorMessage(err, 'Could not load customers'));
    }
  }, [page, query, blockedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBlock = async (c) => {
    const verb = c.is_blocked ? 'Unblock' : 'Block';
    if (!window.confirm(`${verb} ${c.email}?${c.is_blocked ? '' : ' They will be signed out and unable to log in or order.'}`)) return;
    setError('');
    try {
      await setCustomerBlocked(c.id, !c.is_blocked);
      await load();
    } catch (err) {
      setError(errorMessage(err, `Could not ${verb.toLowerCase()} this customer`));
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input className="input" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
        <label className="admin-form__checkbox">
          <input type="checkbox" checked={blockedOnly} onChange={(e) => { setPage(1); setBlockedOnly(e.target.checked); }} /> Blocked only
        </label>
      </div>
      {error && <p className="form-alert form-alert-error">{error}</p>}

      <div className="admin-table-wrap card">
        <table className="admin-table">
          <thead>
            <tr><th scope="col">Customer</th><th scope="col">Joined</th><th scope="col" className="is-num">Orders</th><th scope="col" className="is-num">Spent</th><th scope="col">Last order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <Fragment key={c.id}>
                <tr className={expanded === c.id ? 'is-selected' : ''}>
                  <td>
                    <button type="button" className="admin-link" onClick={() => setExpanded(expanded === c.id ? null : c.id)} aria-expanded={expanded === c.id}>
                      {c.name || 'No name'}
                    </button>
                    <div className="admin-muted">{c.email}</div>
                  </td>
                  <td>{formatOrderDate(c.created_at)}</td>
                  <td className="is-num">{c.order_count}</td>
                  <td className="is-num">{formatMoney(c.total_spent)}</td>
                  <td>{c.last_order_at ? formatOrderDate(c.last_order_at) : '—'}</td>
                  <td>
                    {c.is_blocked ? <span className="badge badge-danger">blocked</span> : c.role === 'ADMIN' ? <span className="badge">admin</span> : <span className="badge badge-muted">{c.is_verified ? 'verified' : 'unverified'}</span>}
                  </td>
                  <td className="admin-row-actions">
                    {c.role !== 'ADMIN' && (
                      <Button size="sm" variant="ghost" className={c.is_blocked ? '' : 'admin-danger'} onClick={() => toggleBlock(c)}>
                        {c.is_blocked ? 'Unblock' : 'Block'}
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded === c.id && (
                  <tr className="admin-table__detail"><td colSpan={7}><CustomerPanel userId={c.id} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

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

export default AdminCustomers;
