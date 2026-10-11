import { useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { getSellerDashboard } from '../../api/marketplace.api';
import { formatOrderDate, statusBadgeClass } from '../../utils/order';
import { errorMessage, formatMoney } from '../Admin/adminUtils';

/** Balance, the last 30 days, what needs doing, and the latest orders. */
const SellerOverview = ({ onOpenTab }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSellerDashboard()
      .then((res) => setData(res.data))
      .catch((err) => setError(errorMessage(err, 'Could not load your dashboard')));
  }, []);

  if (error) return <p className="form-alert form-alert-error">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  const toShip = (data.orders.pending ?? 0) + (data.orders.confirmed ?? 0);
  return (
    <div className="admin-panel">
      <div className="admin-stats">
        <div className="card admin-stat">
          <span className="admin-stat__label">Balance</span>
          <span className="admin-stat__value">{formatMoney(data.money.balance)}</span>
          <span className="admin-stat__change">{formatMoney(data.money.pending_earnings)} on the way</span>
        </div>
        <div className="card admin-stat">
          <span className="admin-stat__label">Sales · 30 days</span>
          <span className="admin-stat__value">{formatMoney(data.last_30_days.sales)}</span>
          <span className="admin-stat__change">{data.last_30_days.orders} orders</span>
        </div>
        <div className="card admin-stat">
          <span className="admin-stat__label">You earn · 30 days</span>
          <span className="admin-stat__value">{formatMoney(data.last_30_days.earnings)}</span>
          <span className="admin-stat__change">after the {Number(data.commission_rate)}% store fee</span>
        </div>
        <div className="card admin-stat">
          <span className="admin-stat__label">Products</span>
          <span className="admin-stat__value">{data.products.total}</span>
          <span className="admin-stat__change">{data.products.hidden} hidden · {data.products.out_of_stock} out of stock</span>
        </div>
      </div>

      {toShip > 0 && (
        <div className="card admin-editor">
          <p><strong>{toShip} order{toShip === 1 ? '' : 's'} to handle.</strong> Confirm and ship them so customers get their items, and you get paid.</p>
          <div><Button size="sm" onClick={() => onOpenTab('orders')}>Open orders</Button></div>
        </div>
      )}
      {data.products.total === 0 && (
        <div className="card admin-editor">
          <p><strong>Add your first product.</strong> It appears in the shop as soon as you save it (unless you hide it).</p>
          <div><Button size="sm" onClick={() => onOpenTab('products')}>Add a product</Button></div>
        </div>
      )}

      <h3>Latest orders</h3>
      {data.recent_orders.length === 0 ? (
        <p className="admin-muted">No orders yet.</p>
      ) : (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col" className="is-num">Items</th><th scope="col" className="is-num">Sale</th><th scope="col" className="is-num">You earn</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {data.recent_orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.order_id}</td>
                  <td>{formatOrderDate(o.created_at)}</td>
                  <td className="is-num">{o._count.items}</td>
                  <td className="is-num">{formatMoney(o.subtotal)}</td>
                  <td className="is-num">{formatMoney(o.seller_earnings)}</td>
                  <td><span className={`badge ${statusBadgeClass(o.status)}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SellerOverview;
