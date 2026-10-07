import { useMemo } from 'react';
import ProductGrid from '../../components/ui/ProductGrid';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { useWishlist } from '../../features/wishlist/WishlistProvider';
import { mapProductForCard } from '../../utils/product';
import './Wishlist.css';

/** /wishlist — products the customer saved with the heart button. */
const Wishlist = () => {
  const { items, status } = useWishlist();
  // Optimistic placeholders (added a moment ago) have no product details yet.
  const products = useMemo(() => items.filter((i) => i.product?.name).map((i, idx) => mapProductForCard(i.product, idx)), [items]);

  return (
    <div className="listing-page container">
      <div className="section-heading">
        <span className="badge">Wishlist</span>
        <h2>Saved for later.</h2>
      </div>
      {status !== 'loading' && products.length === 0 ? (
        <div className="listing-page__empty">
          <Icon name="heart" size={32} />
          <p>Tap the heart on any product to save it here.</p>
          <Button to="/shop">Browse products</Button>
        </div>
      ) : (
        <ProductGrid status={status === 'loading' ? 'loading' : 'ready'} products={products} skeletonCount={4} />
      )}
    </div>
  );
};

export default Wishlist;
