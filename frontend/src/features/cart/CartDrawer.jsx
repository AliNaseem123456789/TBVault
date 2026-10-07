import { Link, useNavigate } from 'react-router-dom';
import { useCart } from './CartProvider';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import { getImageUrl, unitPrice } from '../../utils/product';
import { formatMoney } from '../../utils/money';
import './CartDrawer.css';

/**
 * Slide-in cart panel, rendered once in Layout.jsx so it's available
 * on every storefront page. Opens via useCart().openCart() — the
 * Navbar's cart icon and CartProvider's addItem() (on a successful
 * add) both call it. Works for guests too: their cart lives in the
 * browser until they sign in or check out as a guest.
 */
const CartDrawer = () => {
  const { isOpen, closeCart, items, status, subtotal, updateItem, removeItem, notice, dismissNotice } = useCart();
  const navigate = useNavigate();

  return (
    <>
      <div
        className={`cart-drawer__scrim ${isOpen ? 'is-visible' : ''}`}
        onClick={closeCart}
        aria-hidden="true"
      />
      <aside className={`cart-drawer ${isOpen ? 'is-open' : ''}`} aria-label="Shopping cart" aria-hidden={!isOpen}>
        <div className="cart-drawer__header">
          <h2>Your cart</h2>
          <button type="button" className="cart-drawer__close" onClick={closeCart} aria-label="Close cart">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="cart-drawer__body">
          {notice && (
            <p className="form-alert form-alert-error cart-drawer__notice">
              {notice}{' '}
              <button type="button" className="cart-drawer__remove" onClick={dismissNotice}>Dismiss</button>
            </p>
          )}

          {status === 'loading' && (
            <div className="cart-drawer__skeletons">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton cart-drawer__item-skeleton" />
              ))}
            </div>
          )}

          {status !== 'loading' && items.length === 0 && (
            <div className="cart-drawer__empty">
              <Icon name="cart" size={28} />
              <p>Your cart is empty.</p>
              <Button to="/shop" variant="ghost" onClick={closeCart}>
                Browse products
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="cart-drawer__empty">
              <p>Couldn't load your cart. Try again in a moment.</p>
            </div>
          )}

          {items.length > 0 && (
            <ul className="cart-drawer__list">
              {items.map((item) => {
                const imageUrl = getImageUrl(item.product?.images?.[0]?.key);
                const stock = item.variant ? item.variant.stock : item.product?.stock;
                const atMax = stock != null && item.quantity >= stock;
                const { price, listPrice, onSale } = unitPrice(item.product, item.variant);
                return (
                  <li key={item.id} className="cart-drawer__item">
                    <div className="cart-drawer__item-media">
                      {imageUrl ? (
                        <img src={imageUrl} alt="" loading="lazy" />
                      ) : (
                        <Icon name="image" size={20} />
                      )}
                    </div>
                    <div className="cart-drawer__item-info">
                      <Link to={`/products/${item.product_id}`} onClick={closeCart} className="cart-drawer__item-name">
                        {item.product?.name}
                      </Link>
                      {item.variant && <span className="cart-drawer__item-variant">{item.variant.name}</span>}
                      <span className="cart-drawer__item-price">
                        {formatMoney(price)}
                        {onSale && <s className="cart-drawer__item-price-old">{formatMoney(listPrice)}</s>}
                      </span>
                      <div className="cart-drawer__item-controls">
                        <div className="qty-stepper qty-stepper--sm">
                          <button
                            type="button"
                            onClick={() => updateItem(item.product_id, Math.max(1, item.quantity - 1), item.variant_id)}
                            disabled={item.quantity <= 1}
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateItem(item.product_id, item.quantity + 1, item.variant_id)}
                            disabled={atMax}
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                        <button type="button" className="cart-drawer__remove" onClick={() => removeItem(item.product_id, item.variant_id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="cart-drawer__footer">
            <div className="cart-drawer__subtotal">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <p className="cart-drawer__fine-print">Shipping, tax and coupons are worked out at checkout.</p>
            <Button
              size="lg"
              className="cart-drawer__checkout"
              onClick={() => {
                closeCart();
                navigate('/checkout');
              }}
            >
              Checkout
            </Button>
          </div>
        )}
      </aside>
    </>
  );
};

export default CartDrawer;
