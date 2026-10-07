import { useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import RevenueChart from './RevenueChart';
import { getDashboard, downloadExport } from '../../api/admin.api';
import { errorMessage, formatMoney } from './adminUtils';

const RANGES = [7, 30, 90];

const Change = ({ value, suffix = '%' }) => {
  if (value === null || value === undefined) return <span className="admin-stat__change">No earlier data</span>;
  const up = value >= 0;
  return (
    <span className={`admin-stat__change ${up ? 'is-up' : 'is-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(value)}{suffix} vs previous period
    </span>
  );
};

/** Sales dashboard: headline numbers, revenue by day, top products, order statuses. */
const AdminOverview = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getDashboard(days)
      .then((res) => alive && (setData(res.data), setError('')))
      .catch((err) => alive && setError(errorMessage(err, 'Could not load the dashboard')));
    return () => {
      alive = false;
    };
  }, [days]);

  const totals = data?.totals;
  const maxTop = Math.max(...(data?.top_products ?? []).map((p) => p.revenue), 1);

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <div className="admin-filter" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r} type="button" className={`admin-chip ${days === r ? 'is-active' : ''}`} onClick={() => setDays(r)}>
              Last {r} days
            </button>
          ))}
        </div>
        <div className="admin-toolbar__actions">
          <Button variant="ghost" size="sm" onClick={() => downloadExport('orders').catch((err) => setError(errorMessage(err, 'Export failed')))}>
            <Icon name="download" size={16} /> Orders CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadExport('products').catch((err) => setError(errorMessage(err, 'Export failed')))}>
            <Icon name="download" size={16} /> Products CSV
          </Button>
        </div>
      </div>

      {error && <p className="form-alert form-alert-error">{error}</p>}
      {!data && !error && <div className="skeleton" style={{ height: 320 }} />}

      {data && (
        <>
          <div className="admin-stats">
            <div className="card admin-stat">
              <span className="admin-stat__label">Revenue</span>
              <span className="admin-stat__value">{formatMoney(totals.revenue)}</span>
              <Change value={data.change.revenue} />
            </div>
            <div className="card admin-stat">
              <span className="admin-stat__label">Orders</span>
              <span className="admin-stat__value">{totals.orders}</span>
              <Change value={data.change.orders} />
            </div>
            <div className="card admin-stat">
              <span className="admin-stat__label">Average order</span>
              <span className="admin-stat__value">{formatMoney(totals.average_order_value)}</span>
              <span className="admin-stat__change">{formatMoney(totals.discounts)} in discounts</span>
            </div>
            <div className="card admin-stat">
              <span className="admin-stat__label">Conversion</span>
              <span className="admin-stat__value">{totals.conversion_rate === null ? '—' : `${totals.conversion_rate}%`}</span>
              <span className="admin-stat__change">{totals.visits.toLocaleString()} visits · {totals.new_customers} new customers</span>
            </div>
          </div>

          <div className="card admin-card">
            <RevenueChart series={data.series} />
            {totals.refunded > 0 && <p className="admin-muted">Revenue is after {formatMoney(totals.refunded)} in refunds. Cancelled and unpaid card orders aren't counted.</p>}
          </div>

          <div className="admin-two-col">
            <div className="card admin-card">
              <h3>Top products</h3>
              {data.top_products.length === 0 ? (
                <p className="admin-muted">No sales in this period.</p>
              ) : (
                <ul className="admin-barlist">
                  {data.top_products.map((p) => (
                    <li key={p.product_id}>
                      <div className="admin-barlist__row">
                        <span>{p.name}</span>
                        <span className="admin-barlist__value">{formatMoney(p.revenue)} · {p.quantity} sold</span>
                      </div>
                      <span className="admin-barlist__track"><span className="admin-barlist__bar" style={{ width: `${(p.revenue / maxTop) * 100}%` }} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card admin-card">
              <h3>Orders by status</h3>
              <dl className="admin-dl">
                {['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) => (
                  <div key={s}><dt>{s}</dt><dd>{data.status_breakdown[s] ?? 0}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminOverview;
