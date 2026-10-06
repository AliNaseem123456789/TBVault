import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useCart } from '../../features/cart/CartProvider';
import { useAuth } from '../../features/auth/AuthProvider';
import './ProductCard.css';

/**
 * Standard product tile — used on the landing page and the Shop
 * page. Links through to /products/:id. Expects:
 *   { id, name, category?, price, oldPrice?, rating?, badge?, tone, inStock?, imageUrl?, imageUrlHover? }
 * `category` and `rating` are optional since the products API doesn't
 * return a rating yet. `tone` (1-4) picks a placeholder art
 * background/icon, used whenever there's no `imageUrl` — or if the
 * real photo fails to load (see the onError handler below), so a
 * wrong image URL degrades to the placeholder instead of a broken
 * image icon. When a second image (`imageUrlHover`) is available it
 * crossfades in on hover, on top of the existing zoom effect.
 *
 * The card is split into two <Link>s (media, body) with the
 * "Quick add" button as a sibling rather than nesting a <button>
 * inside an <a> — that nesting is invalid HTML and unreliable for
 * click/keyboard handling.
 */
const ProductCard = ({ product }) => {
  const {
    id,
    name,
    category,
    price,
    oldPrice,
    rating,
    badge,
    tone = 1,
    inStock = true,
    imageUrl,
    imageUrlHover,
  } = product;
  const [photoFailed, setPhotoFailed] = useState(false);
  const [hoverPhotoFailed, setHoverPhotoFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const showPhoto = Boolean(imageUrl) && !photoFailed;
  const showHoverPhoto = showPhoto && Boolean(imageUrlHover) && !hoverPhotoFailed;
  const href = `/products/${id}`;

  const navigate = useNavigate();
  const { addItem } = useCart();
  const { isAuthenticated } = useAuth();

  const handleQuickAdd = async (event) => {
    event.preventDefault();
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setAdding(true);
    try {
      await addItem(id, 1);
    } catch (err) {
      console.error('Failed to add to cart:', err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`product-card card card-hover ${!inStock ? 'is-out-of-stock' : ''}`}>
      <div className="product-card__media">
        <Link to={href} className="product-card__art-link" aria-label={name}>
          <div className={`product-card__art ${showPhoto ? '' : `product-card__art--${tone}`}`}>
            {showPhoto ? (
              <>
                <img
                  src={imageUrl}
                  alt={name}
                  className="product-card__photo"
                  loading="lazy"
                  onError={() => setPhotoFailed(true)}
                />
                {showHoverPhoto && (
                  <img
                    src={imageUrlHover}
                    alt=""
                    aria-hidden="true"
                    className="product-card__photo product-card__photo--hover"
                    loading="lazy"
                    onError={() => setHoverPhotoFailed(true)}
                  />
                )}
              </>
            ) : (
              <Icon name="image" size={28} className="product-card__art-icon" />
            )}
            {badge && <span className="badge product-card__badge">{badge}</span>}
          </div>
        </Link>
        {inStock && (
          <button
            className="product-card__quick-add btn btn-light btn-sm"
            type="button"
            onClick={handleQuickAdd}
            disabled={adding}
          >
            <Icon name="cart" size={16} /> {adding ? 'Adding…' : 'Quick add'}
          </button>
        )}
      </div>

      <Link to={href} className="product-card__info-link">
        <div className="product-card__body">
          {category && <span className="product-card__category">{category}</span>}
          <h3 className="product-card__name">{name}</h3>
          {typeof rating === 'number' && (
            <div className="product-card__rating" aria-label={`Rated ${rating} out of 5`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Icon key={i} name="star" size={14} className={i < rating ? 'is-filled' : 'is-empty'} />
              ))}
            </div>
          )}
          <div className="product-card__price">
            <span>${price}</span>
            {oldPrice && <span className="product-card__price-old">${oldPrice}</span>}
          </div>
        </div>
      </Link>
    </div>
  );
};

export default ProductCard;
