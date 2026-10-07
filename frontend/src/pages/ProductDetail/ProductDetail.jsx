import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import ProductGrid from '../../components/ui/ProductGrid';
import { getProductById, getProducts, getRelatedProducts } from '../../api/products.api';
import { createStockAlert } from '../../api/store.api';
import { getImageUrl, mapProductForCard, unitPrice, activeVariants } from '../../utils/product';
import { formatMoney } from '../../utils/money';
import { addRecentlyViewed, getRecentlyViewed } from '../../utils/recentlyViewed';
import { useCart } from '../../features/cart/CartProvider';
import { useAuth } from '../../features/auth/AuthProvider';
import { useWishlist } from '../../features/wishlist/WishlistProvider';
import { useStoreConfig } from '../../features/store/useStoreConfig';
import ProductReviews from '../../features/reviews/ProductReviews';
import './ProductDetail.css';

// "Back in stock" signup, shown when the product (or the chosen option) is sold out.
const StockAlertForm = ({ productId, variantId }) => {
  const { isAuthenticated, user } = useAuth();
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ sending: false, message: '', error: '' });

  const submit = async (e) => {
    e.preventDefault();
    setState({ sending: true, message: '', error: '' });
    try {
      const res = await createStockAlert(productId, { email: isAuthenticated ? undefined : email, variantId });
      setState({ sending: false, message: res.message, error: '' });
    } catch (err) {
      setState({ sending: false, message: '', error: err?.response?.data?.message || 'Could not save your alert' });
    }
  };

  if (state.message) return <p className="form-alert form-alert-success">{state.message}</p>;
  return (
    <form className="product-detail__alert" onSubmit={submit}>
      <p>
        <Icon name="bell" size={16} /> Sold out. {isAuthenticated ? `We'll email ${user?.email ?? 'you'} when it's back.` : "Get an email when it's back:"}
      </p>
      <div className="product-detail__alert-row">
        {!isAuthenticated && (
          <input
            type="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="Email for back-in-stock alert"
          />
        )}
        <Button type="submit" variant="ghost" disabled={state.sending}>
          {state.sending ? 'Saving…' : 'Notify me'}
        </Button>
      </div>
      {state.error && <p className="form-alert form-alert-error">{state.error}</p>}
    </form>
  );
};

const ProductDetail = () => {
  const { id } = useParams();

  const [status, setStatus] = useState('loading'); // loading | ready | notFound | error
  const [product, setProduct] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [variantId, setVariantId] = useState(null);

  const [related, setRelated] = useState([]);
  const [recent, setRecent] = useState([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const { addItem } = useCart();
  const { isSaved, toggle } = useWishlist();
  const config = useStoreConfig();

  // Load the product itself.
  useEffect(() => {
    let cancelled = false;
    // Reset whenever `id` changes (not just on mount), so navigating
    // between products shows the skeleton instead of stale content.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    setActiveImage(0);
    setQty(1);
    setVariantId(null);
    setAddError('');

    getProductById(id)
      .then((res) => {
        if (cancelled) return;
        const row = res?.data?.product;
        if (!row || row.is_hidden) {
          setStatus('notFound');
          return;
        }
        setProduct(row);
        // Pre-select the first option that's in stock.
        const options = activeVariants(row);
        if (options.length) setVariantId((options.find((v) => v.stock > 0) ?? options[0]).id);
        setStatus('ready');
        addRecentlyViewed(row.id);
      })
      .catch((err) => {
        console.error('Failed to load product:', err);
        if (cancelled) return;
        setStatus(err?.response?.status === 404 ? 'notFound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Related products and "recently viewed", once the product is loaded.
  useEffect(() => {
    if (!product) return;
    let cancelled = false;

    getRelatedProducts(product.id, 4)
      .then((res) => !cancelled && setRelated((res?.data?.products ?? []).map(mapProductForCard)))
      .catch(() => !cancelled && setRelated([]));

    const recentIds = getRecentlyViewed().filter((rid) => rid !== product.id).slice(0, 4);
    if (recentIds.length) {
      getProducts({ ids: recentIds.join(','), limit: 4 })
        .then((res) => {
          if (cancelled) return;
          const rows = res?.data?.products ?? [];
          // Keep the "most recent first" order the ids were stored in.
          rows.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
          setRecent(rows.map(mapProductForCard));
        })
        .catch(() => !cancelled && setRecent([]));
    } else {
      setRecent([]);
    }

    return () => {
      cancelled = true;
    };
  }, [product]);

  const variants = useMemo(() => activeVariants(product), [product]);
  const variant = variants.find((v) => v.id === variantId) ?? null;

  if (status === 'loading') {
    return (
      <div className="product-detail container">
        <div className="product-detail__grid">
          <div className="skeleton product-detail__gallery-skeleton" />
          <div className="product-detail__info-skeleton">
            <div className="skeleton" style={{ width: '40%', height: 14 }} />
            <div className="skeleton" style={{ width: '75%', height: 32 }} />
            <div className="skeleton" style={{ width: '25%', height: 24 }} />
            <div className="skeleton" style={{ width: '100%', height: 80 }} />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'notFound') {
    return (
      <div className="product-detail container product-detail--empty">
        <h1>Product not found</h1>
        <p>It may have been removed or the link is incorrect.</p>
        <Button to="/shop">Back to shop</Button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="product-detail container product-detail--empty">
        <h1>Couldn't load this product</h1>
        <p>Make sure the API is running, then refresh the page.</p>
        <Button to="/shop">Back to shop</Button>
      </div>
    );
  }

  const images = product.images?.length ? product.images : [null];
  const categoryName = product.category?.name;
  const hasOptions = variants.length > 0;
  const stock = hasOptions ? variant?.stock ?? 0 : product.stock;
  const inStock = stock > 0;
  const { price, listPrice, onSale } = unitPrice(product, variant);
  const saved = isSaved(product.id);
  const saleEnds = product.sale_ends_at ? new Date(product.sale_ends_at) : null;

  const handleAdd = async () => {
    setAdding(true);
    setAddError('');
    try {
      await addItem(product.id, qty, { variantId: variant?.id ?? null, product, variant });
    } catch (err) {
      setAddError(err?.response?.data?.message || 'Could not add this to your cart');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="product-detail container">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link>
        {categoryName && (
          <>
            <span>/</span>
            <Link to={`/shop?categoryId=${product.category_id}`}>{categoryName}</Link>
          </>
        )}
        <span>/</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="product-detail__grid">
        <div className="product-detail__gallery">
          <div className="product-detail__main-image">
            {images[activeImage] ? (
              <img src={getImageUrl(images[activeImage].key)} alt={product.name} />
            ) : (
              <Icon name="image" size={40} className="product-detail__main-image-icon" />
            )}
          </div>
          {images.length > 1 && (
            <div className="product-detail__thumbs">
              {images.map((img, i) => (
                <button
                  key={img?.key ?? i}
                  type="button"
                  className={`product-detail__thumb ${i === activeImage ? 'is-active' : ''}`}
                  onClick={() => setActiveImage(i)}
                  aria-label={`Show image ${i + 1}`}
                >
                  <img src={getImageUrl(img.key)} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="product-detail__info">
          <div className="product-detail__badges">
            {categoryName && <span className="badge">{categoryName}</span>}
            {onSale && <span className="badge badge-secondary">{product.sale_percent}% off</span>}
          </div>
          <div className="product-detail__title-row">
            <h1>{product.name}</h1>
            <button
              type="button"
              className={`product-detail__wish ${saved ? 'is-saved' : ''}`}
              onClick={() => toggle(product.id)}
              aria-pressed={saved}
              aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
            >
              <Icon name="heart" size={20} className={saved ? 'is-filled' : ''} />
            </button>
          </div>

          <div className="product-detail__price">
            {formatMoney(price)}
            {onSale && <s className="product-detail__price-old">{formatMoney(listPrice)}</s>}
          </div>
          {onSale && saleEnds && (
            <p className="product-detail__sale-ends">Sale ends {saleEnds.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
          )}

          {hasOptions && (
            <fieldset className="product-detail__options">
              <legend>Option</legend>
              <div className="product-detail__option-list">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`product-detail__option ${v.id === variantId ? 'is-active' : ''} ${v.stock <= 0 ? 'is-sold-out' : ''}`}
                    onClick={() => {
                      setVariantId(v.id);
                      setQty(1);
                    }}
                    aria-pressed={v.id === variantId}
                  >
                    {v.name}
                    {v.stock <= 0 && <span className="visually-hidden"> (sold out)</span>}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <p className={`product-detail__stock ${inStock ? 'is-in-stock' : 'is-out-of-stock'}`}>
            {inStock ? (stock <= 5 ? `Only ${stock} left` : 'In stock') : 'Out of stock'}
          </p>

          {product.description && <p className="product-detail__description">{product.description}</p>}

          {inStock ? (
            <div className="product-detail__actions">
              <div className="qty-stepper">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">
                  −
                </button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty((q) => Math.min(stock, q + 1))} disabled={qty >= stock} aria-label="Increase quantity">
                  +
                </button>
              </div>
              <Button size="lg" disabled={adding} className="product-detail__add" onClick={handleAdd}>
                <Icon name="cart" size={18} /> {adding ? 'Adding…' : 'Add to cart'}
              </Button>
            </div>
          ) : (
            <StockAlertForm key={variantId ?? 'product'} productId={product.id} variantId={variant?.id ?? null} />
          )}
          {addError && <p className="form-alert form-alert-error">{addError}</p>}

          <div className="product-detail__trust">
            <span>
              <Icon name="truck" size={16} />{' '}
              {config?.free_shipping_over ? `Free shipping over ${formatMoney(config.free_shipping_over)}` : 'Fast delivery'}
            </span>
            <span>
              <Icon name="shield" size={16} /> Secure checkout
            </span>
            {config?.return_window_days > 0 && (
              <span>
                <Icon name="return" size={16} /> {config.return_window_days}-day returns
              </span>
            )}
          </div>
        </div>
      </div>

      <ProductReviews productId={product.id} />

      {related.length > 0 && (
        <section className="section product-detail__related">
          <div className="section-heading">
            <span className="badge badge-secondary">You might also like</span>
            <h2>More from {categoryName || 'the shop'}.</h2>
          </div>
          <ProductGrid status="ready" products={related} />
        </section>
      )}

      {recent.length > 0 && (
        <section className="section-tight product-detail__related">
          <div className="section-heading">
            <span className="badge badge-muted">Recently viewed</span>
          </div>
          <ProductGrid status="ready" products={recent} />
        </section>
      )}
    </div>
  );
};

export default ProductDetail;
