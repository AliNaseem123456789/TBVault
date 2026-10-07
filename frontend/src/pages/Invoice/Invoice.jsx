import { Link, useParams } from 'react-router-dom';
import { getOrderById, getOrderByToken } from '../../api/orders.api';
import { useOrderLoader } from '../../features/orders/useOrderLoader';
import { useStoreConfig } from '../../features/store/useStoreConfig';
import { formatMoney } from '../../utils/money';
import { formatOrderDate, paymentLabel } from '../../utils/order';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import './Invoice.css';

/**
 * Printable receipt: /orders/:id/invoice (signed in) or /track/:token/invoice.
 * Rendered outside the site Layout so printing gives a clean page;
 * "Save as PDF" in the print dialog produces the PDF.
 */
const Invoice = () => {
  const { id, token } = useParams();
  const config = useStoreConfig();
  const { status, order } = useOrderLoader(() => (token ? getOrderByToken(token) : getOrderById(id)), `${id}:${token}`);
  const backTo = token ? `/track/${token}` : `/orders/${id}`;

  if (status === 'loading') return <div className="invoice-page"><div className="spinner" /></div>;
  if (status !== 'ready') {
    return (
      <div className="invoice-page">
        <p>Couldn't load this receipt.</p>
        <Link to={backTo}>Back to the order</Link>
      </div>
    );
  }

  const invoiceNumber = `INV-${String(order.id).padStart(6, '0')}`;
  const refunded = Number(order.amount_refunded ?? 0);

  return (
    <div className="invoice-page">
      <div className="invoice-toolbar">
        <Link to={backTo} className="invoice-toolbar__back"><Icon name="arrowRight" size={14} className="invoice-toolbar__back-icon" /> Back to order</Link>
        <Button onClick={() => window.print()} size="sm"><Icon name="download" size={16} /> Print or save as PDF</Button>
      </div>

      <article className="invoice">
        <header className="invoice__header">
          <div>
            <div className="invoice__brand">{config?.store_name || 'TBVault'}</div>
            {config?.store_address && <p className="invoice__muted invoice__pre">{config.store_address}</p>}
            {config?.store_email && <p className="invoice__muted">{config.store_email}</p>}
          </div>
          <div className="invoice__meta">
            <h1>Receipt</h1>
            <dl>
              <div><dt>Receipt no.</dt><dd>{invoiceNumber}</dd></div>
              <div><dt>Order</dt><dd>#{order.id}</dd></div>
              <div><dt>Date</dt><dd>{formatOrderDate(order.order_date ?? order.created_at)}</dd></div>
              <div><dt>Payment</dt><dd>{order.payment_method === 'card' ? 'Card' : 'Cash on delivery'} · {paymentLabel(order)}</dd></div>
            </dl>
          </div>
        </header>

        <section className="invoice__to">
          <h2>Ship to</h2>
          <p className="invoice__pre">{order.shipping_address}</p>
          {order.guest_email && <p className="invoice__muted">{order.guest_email}</p>}
        </section>

        <table className="invoice__table">
          <thead>
            <tr><th scope="col">Item</th><th scope="col" className="is-num">Qty</th><th scope="col" className="is-num">Unit price</th><th scope="col" className="is-num">Amount</th></tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>{i.product_name || i.product?.name || `Product #${i.product_id}`}{i.variant_name ? ` (${i.variant_name})` : ''}</td>
                <td className="is-num">{i.quantity}</td>
                <td className="is-num">{formatMoney(i.unit_price)}</td>
                <td className="is-num">{formatMoney(i.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="invoice__totals">
          <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd></div>
          {Number(order.discount_total) > 0 && <div><dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt><dd>−{formatMoney(order.discount_total)}</dd></div>}
          <div><dt>Shipping</dt><dd>{formatMoney(order.shipping_total)}</dd></div>
          {Number(order.tax_total) > 0 && <div><dt>Tax</dt><dd>{formatMoney(order.tax_total)}</dd></div>}
          <div className="invoice__total"><dt>Total</dt><dd>{formatMoney(order.total_amount)}</dd></div>
          {refunded > 0 && <div><dt>Refunded</dt><dd>−{formatMoney(refunded)}</dd></div>}
        </dl>

        <footer className="invoice__footer">Thank you for shopping with {config?.store_name || 'TBVault'}.</footer>
      </article>
    </div>
  );
};

export default Invoice;
