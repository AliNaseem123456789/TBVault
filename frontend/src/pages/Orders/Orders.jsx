import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrders } from '../../api/orders.api';
import { statusBadgeClass, formatOrderDate, paymentLabel } from '../../utils/order';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import './Orders.css';

/**
 * /orders — the signed-in user's order history. Backed by GET /orders
 * (see orders.api.js), which is already scoped to req.user.sub on the
 * backend, so no client-side filtering is needed here.
 */
const Orders = () => {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');

    getOrders()
      .then((res) => {
        if (cancelled) return;
        const rows = res?.data?.orders ?? [];
        setOrders(rows);
        setStatus(rows.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        console.error('Failed to load orders:', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="orders-page container">
      <div className="orders-page__header">
        <span className="badge badge-secondary">Account</span>
        <h1>Your orders</h1>
      </div>

      {status === 'loading' && (
        <div className="orders-page__list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton orders-page__skeleton" />
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="orders-page__empty">
          <p>Couldn't load your orders. Try refreshing the page.</p>
        </div>
      )}

      {status === 'empty' && (
        <div className="orders-page__empty">
          <Icon name="truck" size={32} />
          <h2>No orders yet</h2>
          <p>When you place an order, it'll show up here.</p>
          <Button to="/shop">Browse products</Button>
        </div>
      )}

      {status === 'ready' && (
        <ul className="orders-page__list">
          {orders.map((order) => (
            <li key={order.id}>
              <Link to={`/orders/${order.id}`} className="card order-row">
                <div className="order-row__main">
                  <span className="order-row__id">Order #{order.id}</span>
                  <span className="order-row__date">{formatOrderDate(order.order_date)}</span>
                </div>
                <span className={`badge ${statusBadgeClass(order.status)}`}>{order.status}</span>
                <span className="order-row__total">
                  ${Number(order.total_amount).toFixed(2)}
                  <small className="order-row__payment">{paymentLabel(order)}</small>
                </span>
                <Icon name="arrowRight" size={16} className="order-row__arrow" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Orders;
