import Reveal from './Reveal';
import ProductCard from './ProductCard';

/**
 * Shared product grid with built-in loading/empty/error states.
 * Used by the landing page's "Trending now" section and the Shop
 * page's results grid — build any future product listing on top of
 * this instead of re-implementing the states.
 *
 *   <ProductGrid status={status} products={products}
 *     emptyMessage="..." errorMessage="..." stagger />
 *
 * `stagger` wraps each card in <Reveal> for a scroll-entrance
 * animation — turn it on for a section that appears once (like the
 * landing page) and leave it off for a grid that re-renders on every
 * filter/page change (like the Shop page), where re-triggering the
 * animation constantly would be distracting.
 */
const ProductGrid = ({ status, products = [], skeletonCount = 8, emptyMessage, errorMessage, stagger = false }) => {
  if (status === 'loading') {
    return (
      <div className="product-grid" aria-hidden="true">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="product-skeleton">
            <div className="skeleton product-skeleton__art" />
            <div className="skeleton product-skeleton__line" style={{ width: '60%' }} />
            <div className="skeleton product-skeleton__line" style={{ width: '35%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="content-placeholder card">
        <p>{emptyMessage || 'Nothing to show yet.'}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="content-placeholder card">
        <p>{errorMessage || "Couldn't load this right now."}</p>
      </div>
    );
  }

  return (
    <div className="product-grid">
      {products.map((product, i) =>
        stagger ? (
          <Reveal key={product.id} delay={(i % 4) + 1}>
            <ProductCard product={product} />
          </Reveal>
        ) : (
          <ProductCard key={product.id} product={product} />
        )
      )}
    </div>
  );
};

export default ProductGrid;
