import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import Button from '../../components/ui/Button';
import ProductGrid from '../../components/ui/ProductGrid';
import { getProductById, getProducts } from '../../api/products.api';
import { getImageUrl, mapProductForCard } from '../../utils/product';
import { useCart } from '../../features/cart/CartProvider';
import { useAuth } from '../../features/auth/AuthProvider';
import ProductReviews from '../../features/reviews/ProductReviews';
import './ProductDetail.css';

const ProductDetail = () => {
  const { id } = useParams();

  const [status, setStatus] = useState('loading'); // loading | ready | notFound | error
  const [product, setProduct] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  const [qty, setQty] = useState(1);

  const [related, setRelated] = useState([]);
  const [adding, setAdding] = useState(false);

  const navigate = useNavigate();
  const { addItem } = useCart();
  const { isAuthenticated } = useAuth();

  // Load the product itself.
  useEffect(() => {
    let cancelled = false;
    // Resetting to 'loading' whenever `id` changes (not just on
    // mount) is intentional, so navigating between products shows
    // the skeleton instead of stale content.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    setActiveImage(0);
    setQty(1);

    getProductById(id)
      .then((res) => {
        if (cancelled) return;
        const row = res?.data?.product;
        // Hidden products aren't meant for the public storefront, even
        // if someone guesses the URL — treat them the same as "not found".
        if (!row || row.is_hidden) {
          setStatus('notFound');
          return;
        }
        setProduct(row);
        setStatus('ready');
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

  // Related products from the same category, once the product is loaded.
  // Note: getProductById doesn't include the category name (only
  // category_id) yet, so the breadcrumb below falls back gracefully
  // when it's missing — see ARCHITECTURE.md / earlier backend notes.
  useEffect(() => {
    if (!product) return;
    let cancelled = false;

    getProducts({ categoryId: product.category_id, limit: 5 })
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.products ?? [])
          .filter((p) => !p.is_hidden && p.id !== product.id)
          .slice(0, 4);
        setRelated(rows.map(mapProductForCard));
      })
      .catch((err) => {
        console.error('Failed to load related products:', err);
        if (!cancelled) setRelated([]);
      });

    return () => {
      cancelled = true;
    };
  }, [product]);

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
  const inStock = product.stock > 0;
  const price = Number(product.price).toFixed(2);

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
          {categoryName && <span className="badge">{categoryName}</span>}
          <h1>{product.name}</h1>

          <div className="product-detail__price">${price}</div>

          <p className={`product-detail__stock ${inStock ? 'is-in-stock' : 'is-out-of-stock'}`}>
            {inStock ? `In stock — ${product.stock} available` : 'Out of stock'}
          </p>

          {product.description && <p className="product-detail__description">{product.description}</p>}

          <div className="product-detail__actions">
            <div className="qty-stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={!inStock || qty <= 1} aria-label="Decrease quantity">
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                disabled={!inStock || qty >= product.stock}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <Button
              size="lg"
              disabled={!inStock || adding}
              className="product-detail__add"
              onClick={async () => {
                if (!isAuthenticated) {
                  navigate('/login');
                  return;
                }
                setAdding(true);
                try {
                  await addItem(product.id, qty);
                } catch (err) {
                  console.error('Failed to add to cart:', err);
                } finally {
                  setAdding(false);
                }
              }}
            >
              <Icon name="cart" size={18} /> {adding ? 'Adding…' : inStock ? 'Add to cart' : 'Out of stock'}
            </Button>
          </div>

          <div className="product-detail__trust">
            <span>
              <Icon name="truck" size={16} /> Free shipping over $50
            </span>
            <span>
              <Icon name="shield" size={16} /> Secure checkout
            </span>
          </div>
        </div>
      </div>

      <ProductReviews productId={product.id} />

      {related.length > 0 && (
        <section className="section product-detail__related">
          <div className="section-heading">
            <span className="badge badge-secondary">You might also like</span>
            <h2>More from {categoryName || 'this category'}.</h2>
          </div>
          <ProductGrid status="ready" products={related} />
        </section>
      )}
    </div>
  );
};

export default ProductDetail;
