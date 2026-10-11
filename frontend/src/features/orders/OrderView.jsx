import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import OrderTimeline from './OrderTimeline';
import ReturnRequestForm from './ReturnRequestForm';
import { getImageUrl } from '../../utils/product';
import { formatMoney } from '../../utils/money';
import { statusBadgeClass, isCancellable, formatOrderDate, paymentLabel } from '../../utils/order';
import { useStoreConfig } from '../store/useStoreConfig';
import '../../pages/OrderDetail/OrderDetail.css';

const RETURN_STATUS_TEXT = {
  REQUESTED: 'Requested — we\'ll review it shortly',
  APPROVED: 'Approved — please send the items back',
  REJECTED: 'Not accepted',
  RECEIVED: 'Items received',
  REFUNDED: 'Refunded',
};

/**
 * Everything about one order, for a signed-in customer (/orders/:id) or anyone
 * with the tracking link (/track/:token). The page wrapper loads the order and
 * passes in what the actions should call:
 *   actions = { cancel(), pay(), requestReturn(body) }   (each returns a promise)
 *   invoiceTo = link to the printable receipt
 *   paymentResult = 'success' | 'cancelled' | null  (from Stripe's redirect)
 */
const OrderView = ({ order, actions, invoiceTo, backLink, justPlaced = false, paymentResult = null }) => {
  const config = useStoreConfig();
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnSent, setReturnSent] = useState(false);

  const run = async (name, fn) => {
    setBusy(name);
    setActionError('');
    try {
      await fn();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy('');
    }
  };

  // How many of each item can still be returned (not already in a non-rejected return).
  const remaining = useMemo(() => {
    const used = {};
    for (const r of order.return_requests ?? []) {
      if (r.status === 'REJECTED') continue;
      for (const ri of r.items ?? []) used[ri.order_item_id] = (used[ri.order_item_id] ?? 0) + ri.quantity;
    }
    return Object.fromEntries((order.items ?? []).map((i) => [i.id, i.quantity - (used[i.id] ?? 0)]));
  }, [order]);

  const windowDays = config?.return_window_days ?? 0;
  const returnDeadline = order.delivered_at ? new Date(new Date(order.delivered_at).getTime() + windowDays * 86400000) : null;
  const canReturn =
    order.status === 'delivered' && windowDays > 0 && returnDeadline > new Date() && Object.values(remaining).some((n) => n > 0);

  const unpaidCard = order.payment_method === 'card' && order.payment_status === 'unpaid' && order.status === 'pending';
  const hasTracking = order.tracking_number || order.tracking_url;
  const refunds = order.refunds ?? [];
  // Orders with items from several sellers arrive in several parcels.
  const marketplaceShipments = (order.seller_orders ?? []).filter((so) => so.status !== 'cancelled' || order.status === 'cancelled');

  return (
    <div className="order-detail container">
      {backLink && (
        <Link to={backLink.to} className="order-detail__back">
          <Icon name="arrowRight" size={14} className="order-detail__back-icon" /> {backLink.label}
        </Link>
      )}

      <div className="order-detail__header">
        <div>
          <h1>Order #{order.id}</h1>
          <p>Placed {formatOrderDate(order.order_date ?? order.created_at)} · {paymentLabel(order)}</p>
        </div>
        <div className="order-detail__header-actions">
          <span className={`badge ${statusBadgeClass(order.status)}`}>{order.status}</span>
          {invoiceTo && (
            <Link to={invoiceTo} className="order-detail__invoice-link">
              <Icon name="receipt" size={16} /> Receipt
            </Link>
          )}
        </div>
      </div>

      {justPlaced && !unpaidCard && (
        <p className="form-alert form-alert-success order-detail__placed">Thanks — your order has been placed! A confirmation email is on its way.</p>
      )}
      {paymentResult === 'success' && (
        <p className="form-alert form-alert-success order-detail__placed">
          {order.payment_status === 'unpaid' ? 'Thanks! We\'re confirming your payment — this page updates in a moment.' : 'Payment received. Thank you!'}
        </p>
      )}
      {paymentResult === 'cancelled' && unpaidCard && (
        <p className="form-alert form-alert-error order-detail__placed">Your payment wasn't completed. You can try again below.</p>
      )}
      {actionError && <p className="form-alert form-alert-error order-detail__placed">{actionError}</p>}

      {unpaidCard && actions?.pay && (
        <section className="card order-detail__pay">
          <div>
            <h2><Icon name="card" size={18} /> Payment needed</h2>
            <p>This order is reserved for you, but it isn't paid yet. Unpaid orders are cancelled after about 30 minutes.</p>
          </div>
          <Button onClick={() => run('pay', actions.pay)} disabled={busy === 'pay'}>
            {busy === 'pay' ? 'Opening payment…' : `Pay ${formatMoney(order.total_amount)}`}
          </Button>
        </section>
      )}

      <section className="card order-detail__progress">
        <OrderTimeline order={order} />
        {marketplaceShipments.length > 1 && (
          <ul className="order-detail__shipments">
            {marketplaceShipments.map((so) => (
              <li key={so.id}>
                <span>
                  <Icon name="store" size={16} /> {so.seller?.is_platform ? 'Shipped by us' : `From ${so.seller?.store_name}`}
                </span>
                <span className={`badge ${statusBadgeClass(so.status)}`}>{so.status}</span>
                {so.tracking_number && (
                  <span className="order-detail__muted">
                    {so.tracking_carrier ? `${so.tracking_carrier} · ` : ''}
                    {so.tracking_url ? <a href={so.tracking_url} target="_blank" rel="noopener noreferrer">{so.tracking_number}</a> : so.tracking_number}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasTracking && (
          <div className="order-detail__tracking">
            <Icon name="truck" size={18} />
            <span>
              {order.tracking_carrier ? `${order.tracking_carrier} · ` : ''}
              {order.tracking_number && <strong>{order.tracking_number}</strong>}
            </span>
            {order.tracking_url && (
              <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                Track parcel
              </a>
            )}
          </div>
        )}
      </section>

      <div className="order-detail__grid">
        <section className="card order-detail__items">
          <h2>Items</h2>
          <ul>
            {(order.items ?? []).map((item) => {
              const imageUrl = getImageUrl(item.product?.images?.[0]?.key);
              const discounted = item.list_price && Number(item.list_price) > Number(item.unit_price);
              return (
                <li key={item.id} className="order-item">
                  <div className="order-item__thumb">
                    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <Icon name="image" size={20} />}
                  </div>
                  <div className="order-item__info">
                    <Link to={`/products/${item.product_id}`} className="order-item__name">
                      {item.product_name || item.product?.name || `Product #${item.product_id}`}
                    </Link>
                    <span className="order-item__meta">
                      {item.variant_name ? `${item.variant_name} · ` : ''}Qty {item.quantity} × {formatMoney(item.unit_price)}
                      {discounted && <s className="order-item__was"> {formatMoney(item.list_price)}</s>}
                    </span>
                  </div>
                  <span className="order-item__total">{formatMoney(item.total_price)}</span>
                </li>
              );
            })}
          </ul>

          <dl className="order-detail__totals">
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd></div>
            {Number(order.discount_total) > 0 && (
              <div className="is-discount"><dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt><dd>−{formatMoney(order.discount_total)}</dd></div>
            )}
            <div><dt>Shipping</dt><dd>{Number(order.shipping_total) > 0 ? formatMoney(order.shipping_total) : 'Free'}</dd></div>
            {Number(order.tax_total) > 0 && <div><dt>Tax</dt><dd>{formatMoney(order.tax_total)}</dd></div>}
            <div className="order-detail__total"><dt>Total</dt><dd>{formatMoney(order.total_amount)}</dd></div>
            {Number(order.credits_applied) > 0 && (
              <div className="is-discount"><dt>Paid with store credit</dt><dd>{formatMoney(order.credits_applied)}</dd></div>
            )}
            {refunds.map((r) => (
              <div key={r.id} className="is-refund">
                <dt>Refund{r.method === 'credits' ? ' to store credit' : ''} · {formatOrderDate(r.created_at)}{r.status === 'pending' ? ' (processing)' : ''}</dt>
                <dd>−{formatMoney(r.amount)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="order-detail__side">
          <section className="card order-detail__shipping">
            <h2>Shipping to</h2>
            <p>{order.shipping_address || 'No shipping address on file.'}</p>
          </section>

          {isCancellable(order.status) && actions?.cancel && (
            <section className="card order-detail__cancel">
              <h2>Need to cancel?</h2>
              <p>
                You can cancel until it ships.
                {order.payment_status === 'paid' ? ' Your card will be refunded automatically.' : ''}
              </p>
              <Button
                variant="ghost"
                onClick={() => window.confirm(`Cancel order #${order.id}?`) && run('cancel', actions.cancel)}
                disabled={busy === 'cancel'}
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
              </Button>
            </section>
          )}

          {((order.return_requests ?? []).length > 0 || canReturn) && (
            <section className="card order-detail__returns">
              <h2><Icon name="return" size={18} /> Returns</h2>
              {(order.return_requests ?? []).map((r) => (
                <div key={r.id} className="order-return">
                  <div className="order-return__head">
                    <strong>Return #{r.id}</strong>
                    <span className={`badge ${r.status === 'REJECTED' ? 'badge-danger' : r.status === 'REFUNDED' ? 'badge-secondary' : 'badge-muted'}`}>
                      {r.status.toLowerCase()}
                    </span>
                  </div>
                  <p>{RETURN_STATUS_TEXT[r.status]}</p>
                  {r.admin_note && <p className="order-return__note">“{r.admin_note}”</p>}
                  {r.refund_amount && <p>Refund: {formatMoney(r.refund_amount)}</p>}
                </div>
              ))}
              {returnSent && <p className="form-alert form-alert-success">Return requested. We'll email you when it's reviewed.</p>}
              {canReturn && actions?.requestReturn && !showReturnForm && (
                <>
                  <p className="order-detail__muted">
                    You can return items until {returnDeadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.
                  </p>
                  <Button variant="ghost" onClick={() => setShowReturnForm(true)}>Return items</Button>
                </>
              )}
              {showReturnForm && (
                <ReturnRequestForm
                  order={order}
                  remaining={remaining}
                  onCancel={() => setShowReturnForm(false)}
                  onSubmit={async (body) => {
                    await actions.requestReturn(body);
                    setShowReturnForm(false);
                    setReturnSent(true);
                  }}
                />
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default OrderView;
