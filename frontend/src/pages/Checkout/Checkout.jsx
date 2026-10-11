import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../features/cart/CartProvider';
import { useAuth } from '../../features/auth/AuthProvider';
import { useStoreConfig } from '../../features/store/useStoreConfig';
import { quoteOrder, createOrder, createGuestOrder } from '../../api/orders.api';
import { getAddresses, createAddress } from '../../api/addresses.api';
import { getImageUrl } from '../../utils/product';
import { formatMoney } from '../../utils/money';
import AddressForm from '../../features/addresses/AddressForm';
import { EMPTY_ADDRESS } from '../../features/addresses/emptyAddress';
import { AddressSummary } from '../../features/addresses/AddressBook';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import '../../features/addresses/Addresses.css';
import './Checkout.css';

const NEW_ADDRESS = 'new';

/**
 * /checkout — works for signed-in customers and guests.
 *
 * Every number on this page comes from POST /order/quote, which prices the
 * cart on the server (sales, coupon, shipping zone for the address, tax).
 * The browser never computes the total it sends; placing the order re-prices
 * everything again inside the order transaction.
 *
 * Card payments go to Stripe's hosted page (checkout_url) and come back to
 * the order page with ?payment=success. Cash on delivery goes straight there.
 * Each attempt sends an Idempotency-Key, so a double click can't order twice.
 */
const Checkout = () => {
  const { items, refresh, clear, isGuest } = useCart();
  const { user } = useAuth();
  const config = useStoreConfig();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [addresses, setAddresses] = useState([]);
  const [addressChoice, setAddressChoice] = useState(NEW_ADDRESS);
  const [newAddress, setNewAddress] = useState(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [useCredits, setUseCredits] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState('');

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());

  // Saved addresses: default one pre-selected.
  useEffect(() => {
    if (isGuest) return;
    let alive = true;
    getAddresses()
      .then((res) => {
        if (!alive) return;
        const list = res?.data?.addresses ?? [];
        setAddresses(list);
        if (list.length) setAddressChoice(list[0].id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isGuest]);

  const cardEnabled = Boolean(config?.card_payments_enabled);

  // What the quote and the order need to know about the address.
  const addressPayload = useMemo(() => {
    if (!isGuest && addressChoice !== NEW_ADDRESS) return { address_id: addressChoice };
    return { address: newAddress };
  }, [isGuest, addressChoice, newAddress]);

  // Only the parts that change the price (region and coupon) re-trigger a quote.
  const quoteKey = JSON.stringify([
    items.map((i) => [i.product_id, i.variant_id, i.quantity]),
    addressPayload.address_id ?? [newAddress.city, newAddress.state, newAddress.country],
    couponCode,
    useCredits,
  ]);

  useEffect(() => {
    if (items.length === 0) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const body = {
          ...(isGuest ? { items: items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })), email } : {}),
          ...(addressPayload.address_id ? { address_id: addressPayload.address_id } : { address: newAddress }),
          ...(couponCode ? { coupon_code: couponCode } : {}),
          ...(!isGuest && useCredits ? { use_credits: true } : {}),
        };
        const res = await quoteOrder(body);
        if (alive) setQuote(res.data);
      } catch (err) {
        if (alive) setError(err?.response?.data?.message || 'Could not work out your total');
      } finally {
        if (alive) setQuoting(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // quoteKey covers items, address region, coupon and store credit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  // Store credit pays everything: no card or cash needed.
  const coveredByCredit = !isGuest && useCredits && Number(quote?.totals?.credits_applied ?? 0) > 0 && Number(quote?.totals?.amount_due ?? 1) === 0;

  const applyCoupon = (e) => {
    e.preventDefault();
    setError('');
    setCouponCode(couponInput.trim().toUpperCase());
  };

  const removeCoupon = () => {
    setCouponCode('');
    setCouponInput('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (quote?.problems?.length) {
      setError(quote.problems[0]);
      return;
    }
    setPlacing(true);
    try {
      const common = {
        coupon_code: quote?.coupon ? couponCode : undefined,
        payment_method: coveredByCredit ? 'credits' : paymentMethod,
        ...(!isGuest && useCredits ? { use_credits: true } : {}),
      };
      let res;
      if (isGuest) {
        res = await createGuestOrder(
          { ...common, email, address: newAddress, items: items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })) },
          idempotencyKey.current
        );
      } else {
        let body = { ...common, ...addressPayload };
        // Keep a new address for next time when asked to.
        if (addressChoice === NEW_ADDRESS && saveAddress) {
          const saved = await createAddress(newAddress);
          body = { ...common, address_id: saved.data.address.id };
        }
        res = await createOrder(body, idempotencyKey.current);
      }

      const { order, checkout_url: checkoutUrl, tracking_token: trackingToken } = res.data;
      if (isGuest) await clear();
      else refresh();

      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      if (trackingToken) navigate(`/track/${trackingToken}`, { state: { justPlaced: true } });
      else navigate(`/orders/${order.id}`, { state: { justPlaced: true } });
    } catch (err) {
      // A 4xx means the server rejected this attempt (and released the key); start fresh next time.
      if (err?.response?.status && err.response.status < 500 && err.response.status !== 409) {
        idempotencyKey.current = crypto.randomUUID();
      }
      setError(err?.response?.data?.message || 'Could not place your order. Please try again.');
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

  const totals = quote?.totals;
  const quoteItems = quote?.items ?? [];
  const blocked = Boolean(quote?.problems?.length);
  const creditBalance = Number(quote?.credit_balance ?? 0);
  const creditsApplied = Number(totals?.credits_applied ?? 0);
  const amountDue = totals ? Number(totals.amount_due ?? totals.total) : 0;
  const payLabel = coveredByCredit ? 'Pay with store credit' : paymentMethod === 'card' ? 'Continue to payment' : 'Place order';

  return (
    <div className="checkout-page container">
      <div className="checkout-page__header">
        <span className="badge badge-secondary">Checkout</span>
        <h1>Almost there</h1>
      </div>

      <div className="checkout-page__grid">
        <form className="checkout-form" onSubmit={handleSubmit}>
          <section className="card checkout-section">
            <h2><span className="checkout-section__step">1</span> Contact</h2>
            {isGuest ? (
              <>
                <div className="field">
                  <label htmlFor="checkout-email">Email</label>
                  <input
                    id="checkout-email"
                    type="email"
                    className="input"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="For your receipt and tracking link"
                    required
                  />
                </div>
                <p className="checkout-form__note">
                  Checking out as a guest. <Link to="/login" state={{ from: '/checkout' }}>Sign in</Link> to use saved addresses — your cart comes with you.
                </p>
              </>
            ) : (
              <p className="checkout-section__static">{user?.email}</p>
            )}
          </section>

          <section className="card checkout-section">
            <h2><span className="checkout-section__step">2</span> Shipping address</h2>
            {!isGuest && addresses.length > 0 && (
              <ul className="address-picker" role="radiogroup" aria-label="Shipping address">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <label className={`address-picker__option ${addressChoice === a.id ? 'is-selected' : ''}`}>
                      <input type="radio" name="address" checked={addressChoice === a.id} onChange={() => setAddressChoice(a.id)} />
                      <AddressSummary address={a} />
                    </label>
                  </li>
                ))}
                <li>
                  <label className={`address-picker__option ${addressChoice === NEW_ADDRESS ? 'is-selected' : ''}`}>
                    <input type="radio" name="address" checked={addressChoice === NEW_ADDRESS} onChange={() => setAddressChoice(NEW_ADDRESS)} />
                    <span>Use a new address</span>
                  </label>
                </li>
              </ul>
            )}
            {(isGuest || addressChoice === NEW_ADDRESS) && (
              <>
                <AddressForm idPrefix="checkout" value={newAddress} onChange={setNewAddress} />
                {!isGuest && (
                  <label className="address-form__checkbox">
                    <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Save this address for next time
                  </label>
                )}
              </>
            )}
          </section>

          <section className="card checkout-section">
            <h2><span className="checkout-section__step">3</span> Payment</h2>
            {!isGuest && creditBalance > 0 && (
              <label className={`payment-option payment-option--credit ${useCredits ? 'is-selected' : ''}`}>
                <input type="checkbox" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} />
                <Icon name="wallet" size={18} />
                <span>
                  <strong>Use store credit</strong>
                  <small>{formatMoney(creditBalance)} available{useCredits && creditsApplied > 0 ? ` · ${formatMoney(creditsApplied)} applied` : ''}</small>
                </span>
              </label>
            )}
            {coveredByCredit ? (
              <p className="checkout-form__note">Your store credit covers this order — nothing else to pay.</p>
            ) : (
            <div className="payment-options" role="radiogroup" aria-label="Payment method">
              <label className={`payment-option ${paymentMethod === 'cod' ? 'is-selected' : ''}`}>
                <input type="radio" name="payment" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} />
                <Icon name="truck" size={18} />
                <span>
                  <strong>Cash on delivery</strong>
                  <small>Pay when your order arrives.</small>
                </span>
              </label>
              <label className={`payment-option ${paymentMethod === 'card' ? 'is-selected' : ''} ${cardEnabled ? '' : 'is-disabled'}`}>
                <input type="radio" name="payment" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} disabled={!cardEnabled} />
                <Icon name="card" size={18} />
                <span>
                  <strong>Card</strong>
                  <small>{cardEnabled ? 'Secure payment with Stripe.' : 'Not available right now.'}</small>
                </span>
              </label>
            </div>
            )}
          </section>

          {error && <p className="form-alert form-alert-error">{error}</p>}

          <Button type="submit" size="lg" disabled={placing || quoting || blocked || !totals} className="checkout-form__submit">
            {placing ? 'Placing order…' : totals ? `${payLabel} — ${formatMoney(coveredByCredit ? creditsApplied : amountDue)}` : 'Working out your total…'}
          </Button>
          <p className="checkout-form__note">
            {!coveredByCredit && paymentMethod === 'card'
              ? "You'll pay on Stripe's secure page, then come back here."
              : 'You can cancel any time before it ships.'}
          </p>
        </form>

        <aside className="card checkout-summary" aria-busy={quoting}>
          <h2>Order summary</h2>
          <ul className="checkout-summary__list">
            {(quoteItems.length ? quoteItems : items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity, product_name: i.product?.name, variant_name: i.variant?.name, image_key: i.product?.images?.[0]?.key }))).map((item) => {
              const imageUrl = getImageUrl(item.image_key);
              return (
                <li key={`${item.product_id}:${item.variant_id ?? ''}`} className={`checkout-summary__item ${item.problem ? 'has-problem' : ''}`}>
                  <div className="checkout-summary__thumb">
                    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <Icon name="image" size={18} />}
                  </div>
                  <div className="checkout-summary__info">
                    <span className="checkout-summary__name">{item.product_name ?? `Product #${item.product_id}`}</span>
                    <span className="checkout-summary__qty">
                      {item.variant_name ? `${item.variant_name} · ` : ''}Qty {item.quantity}
                    </span>
                    {item.seller && !item.seller.is_platform && <span className="checkout-summary__qty">Sold by {item.seller.store_name}</span>}
                    {item.problem && <span className="checkout-summary__problem">{item.problem === 'stock' ? (item.stock > 0 ? `Only ${item.stock} left` : 'Out of stock') : 'Unavailable'}</span>}
                  </div>
                  <span className="checkout-summary__price">
                    {item.total_price ? formatMoney(item.total_price) : '—'}
                    {item.sale_percent && <small className="checkout-summary__sale">-{item.sale_percent}%</small>}
                  </span>
                </li>
              );
            })}
          </ul>

          <form className="checkout-coupon" onSubmit={applyCoupon}>
            {quote?.coupon ? (
              <div className="checkout-coupon__applied">
                <Icon name="tag" size={16} />
                <span>
                  <strong>{quote.coupon.code}</strong>
                  {quote.coupon.description && <small>{quote.coupon.description}</small>}
                </span>
                <button type="button" onClick={removeCoupon}>Remove</button>
              </div>
            ) : (
              <>
                <label htmlFor="coupon" className="visually-hidden">Coupon code</label>
                <input
                  id="coupon"
                  className="input"
                  placeholder="Coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  maxLength={40}
                />
                <Button type="submit" variant="ghost" disabled={!couponInput.trim()}>Apply</Button>
              </>
            )}
          </form>
          {couponCode && quote?.coupon_error && <p className="form-alert form-alert-error">{quote.coupon_error}</p>}

          <dl className="checkout-summary__totals">
            <div><dt>Subtotal</dt><dd>{totals ? formatMoney(totals.subtotal) : '—'}</dd></div>
            {totals && Number(totals.discount) > 0 && (
              <div className="is-discount"><dt>Discount</dt><dd>−{formatMoney(totals.discount)}</dd></div>
            )}
            <div>
              <dt>Shipping{quote?.shipping_zone ? ` (${quote.shipping_zone.name})` : ''}</dt>
              <dd>{totals ? (Number(totals.shipping) > 0 ? formatMoney(totals.shipping) : 'Free') : '—'}</dd>
            </div>
            {totals && Number(totals.tax) > 0 && (
              <div><dt>Tax ({quote.tax_rate}%)</dt><dd>{formatMoney(totals.tax)}</dd></div>
            )}
            <div className="checkout-summary__total"><dt>Total</dt><dd>{totals ? formatMoney(totals.total) : '—'}</dd></div>
            {creditsApplied > 0 && (
              <>
                <div className="is-discount"><dt>Store credit</dt><dd>−{formatMoney(creditsApplied)}</dd></div>
                <div className="checkout-summary__total"><dt>To pay</dt><dd>{formatMoney(amountDue)}</dd></div>
              </>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
};

export default Checkout;
