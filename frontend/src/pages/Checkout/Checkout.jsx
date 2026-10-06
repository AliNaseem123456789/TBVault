import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../features/cart/CartProvider';
import { createOrder } from '../../api/orders.api';
import { getImageUrl } from '../../utils/product';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import './Checkout.css';

/**
 * /checkout — shipping details + order summary, backed by the real
 * POST /orders. The backend only stores shipping_address as a single
 * text column (see orders.controller.js's commented Order model), so
 * the structured fields below are purely a nicer input experience —
 * they get joined into one string before the request goes out.
 *
 * There's no payment step here: createOrder doesn't touch payment at
 * all (no gateway wired up on the backend yet), so this is a
 * place-order-now / pay-on-delivery-style flow until that's decided.
 *
 * Placing an order sends an Idempotency-Key header (see orders.api.js).
 */
const Checkout = () => {
  const { items, subtotal, refresh } = useCart();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: '', phone: '', street: '', city: '', postalCode: '' });
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  // One key per checkout attempt. Retries reuse it, so the server can't create the order twice.
  const idempotencyKey = useRef(crypto.randomUUID());

  const updateField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const shippingAddress = [
      form.fullName,
      form.street,
      [form.city, form.postalCode].filter(Boolean).join(', '),
      form.phone && `Phone: ${form.phone}`,
    ]
      .filter(Boolean)
      .join('\n');

    setPlacing(true);
    try {
      const res = await createOrder(shippingAddress, idempotencyKey.current);
      const orderId = res?.data?.order?.id;
      refresh?.();
      if (orderId) {
        navigate(`/orders/${orderId}`, { state: { justPlaced: true } });
      } else {
        navigate('/orders');
      }
    } catch (err) {
      // A 4xx means the server rejected this attempt (and released the key); start fresh next time.
      if (err?.response?.status && err.response.status < 500 && err.response.status !== 409) {
        idempotencyKey.current = crypto.randomUUID();
      }
      setError(err?.response?.data?.message || 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="checkout-page checkout-page--empty container">
        <Icon name="cart" size={32} />
        <h1>Your cart is empty</h1>
        <p>Add something to your cart before checking out.</p>
        <Button to="/shop">Browse products</Button>
      </div>
    );
  }

  return (
    <div className="checkout-page container">
      <div className="checkout-page__header">
        <span className="badge badge-secondary">Checkout</span>
        <h1>Shipping details</h1>
      </div>

      <div className="checkout-page__grid">
        <form className="card checkout-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="checkout-name">Full name</label>
            <input
              id="checkout-name"
              className="input"
              value={form.fullName}
              onChange={updateField('fullName')}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="checkout-street">Street address</label>
            <input
              id="checkout-street"
              className="input"
              placeholder="House / flat, street, area"
              value={form.street}
              onChange={updateField('street')}
              required
            />
          </div>

          <div className="checkout-form__row">
            <div className="field">
              <label htmlFor="checkout-city">City</label>
              <input id="checkout-city" className="input" value={form.city} onChange={updateField('city')} required />
            </div>
            <div className="field">
              <label htmlFor="checkout-postal">Postal code</label>
              <input
                id="checkout-postal"
                className="input"
                value={form.postalCode}
                onChange={updateField('postalCode')}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="checkout-phone">Phone number</label>
            <input
              id="checkout-phone"
              type="tel"
              className="input"
              placeholder="For delivery updates"
              value={form.phone}
              onChange={updateField('phone')}
              required
            />
          </div>

          {error && <p className="form-alert form-alert-error">{error}</p>}

          <Button type="submit" size="lg" disabled={placing} className="checkout-form__submit">
            {placing ? 'Placing order…' : `Place order — $${subtotal.toFixed(2)}`}
          </Button>
          <p className="checkout-form__note">Pay on delivery. You can review your order before it ships.</p>
        </form>

        <aside className="card checkout-summary">
          <h2>Order summary</h2>
          <ul className="checkout-summary__list">
            {items.map((item) => {
              const imageUrl = getImageUrl(item.product?.images?.[0]?.key);
              return (
                <li key={item.id} className="checkout-summary__item">
                  <div className="checkout-summary__thumb">
                    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <Icon name="image" size={18} />}
                  </div>
                  <div className="checkout-summary__info">
                    <span className="checkout-summary__name">{item.product?.name}</span>
                    <span className="checkout-summary__qty">Qty {item.quantity}</span>
                  </div>
                  <span className="checkout-summary__price">
                    ${(Number(item.product?.price ?? 0) * item.quantity).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="checkout-summary__total">
            <span>Total</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Checkout;
