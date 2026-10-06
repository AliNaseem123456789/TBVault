import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getOrderById, cancelOrder } from '../../api/orders.api';
import { getImageUrl } from '../../utils/product';
import { statusBadgeClass, isCancellable, formatOrderDate } from '../../utils/order';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import './OrderDetail.css';

/**
 * /orders/:id — full detail for a single order. getOrderById's
 * response includes each item's product + primary image (unlike
 * createOrder's/cancelOrder's leaner responses — see orders.api.js),
 * so this is the one place that can render a rich items list.
 *
 * Known backend gap (flagged in orders.api.js too): getOrderById
 * doesn't scope its query by the signed-in user, so this page can't
 * defend against that itself — it just renders whatever comes back.
 */
const OrderDetail = () => {
  const { id } = useParams();
  const location = useLocation();
  const justPlaced = Boolean(location.state?.justPlaced);

  const [status, setStatus] = useState('loading'); // loading | ready | notFound | error
  const [order, setOrder] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');

    getOrderById(id)
      .then((res) => {
        if (cancelled) return;
        const row = res?.data?.order;
        // getOrderById doesn't 404 on a missing id — it just returns
        // data: { order: null } — so treat that the same as not found.
        if (!row) {
          setStatus('notFound');
          return;
        }
        setOrder(row);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load order:', err);
        if (!cancelled) setStatus(err?.response?.status === 404 ? 'notFound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCancel = async () => {
    setCancelError('');
    setCancelling(true);
    try {
      await cancelOrder(id);
      // cancelOrder's response doesn't include product-level detail
      // (see orders.api.js) — flip the status locally on the rich
      // order we already have instead of replacing it wholesale.
      setOrder((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
    } catch (err) {
      setCancelError(err?.response?.data?.message || 'Could not cancel this order.');
    } finally {
      setCancelling(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="order-detail container">
        <div className="skeleton" style={{ height: 32, width: '30%', marginBottom: 'var(--space-5)' }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  if (status === 'notFound') {
    return (
      <div className="order-detail container order-detail--empty">
        <h1>Order not found</h1>
        <p>It may not exist, or the link is incorrect.</p>
        <Button to="/orders">Back to your orders</Button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="order-detail container order-detail--empty">
        <h1>Couldn't load this order</h1>
        <p>Make sure the API is running, then refresh the page.</p>
        <Button to="/orders">Back to your orders</Button>
      </div>
    );
  }

  return (
    <div className="order-detail container">
      <Link to="/orders" className="order-detail__back">
        <Icon name="arrowRight" size={14} className="order-detail__back-icon" /> Back to your orders
      </Link>

      <div className="order-detail__header">
        <div>
          <h1>Order #{order.id}</h1>
          <p>Placed {formatOrderDate(order.order_date)}</p>
        </div>
        <span className={`badge ${statusBadgeClass(order.status)}`}>{order.status}</span>
      </div>

      {justPlaced && (
        <p className="form-alert form-alert-success order-detail__placed">
          Thanks — your order has been placed!
        </p>
      )}

      <div className="order-detail__grid">
        <section className="card order-detail__items">
          <h2>Items</h2>
          <ul>
            {(order.items ?? []).map((item) => {
              const imageUrl = getImageUrl(item.product?.images?.[0]?.key);
              return (
                <li key={item.id} className="order-item">
                  <div className="order-item__thumb">
                    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <Icon name="image" size={20} />}
                  </div>
                  <div className="order-item__info">
                    <span className="order-item__name">{item.product?.name || `Product #${item.product_id}`}</span>
                    <span className="order-item__meta">
                      Qty {item.quantity} × ${Number(item.unit_price).toFixed(2)}
                    </span>
                  </div>
                  <span className="order-item__total">${Number(item.total_price).toFixed(2)}</span>
                </li>
              );
            })}
          </ul>
          <div className="order-detail__total">
            <span>Total</span>
            <span>${Number(order.total_amount).toFixed(2)}</span>
          </div>
        </section>

        <aside className="order-detail__side">
          <section className="card order-detail__shipping">
            <h2>Shipping to</h2>
            <p>{order.shipping_address || 'No shipping address on file.'}</p>
          </section>

          {isCancellable(order.status) && (
            <section className="card order-detail__cancel">
              <h2>Need to cancel?</h2>
              <p>You can cancel this order as long as it hasn't shipped yet.</p>
              {cancelError && <p className="form-alert form-alert-error">{cancelError}</p>}
              <Button variant="ghost" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel order'}
              </Button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default OrderDetail;
