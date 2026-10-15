import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ProductGrid from '../../components/ui/ProductGrid';
import { getProducts } from '../../api/products.api';
import { mapProductForCard } from '../../utils/product';
import './Collection.css';

const PAGE_SIZE = 12;

const COLLECTIONS = {
  'new-arrivals': {
    eyebrow: 'Just in',
    title: 'New arrivals',
    lead: 'The latest products from our sellers, newest first.',
    params: { sortBy: 'created_at', order: 'desc' },
  },
  'best-sellers': {
    eyebrow: 'Most loved',
    title: 'Best sellers',
    lead: 'What shoppers buy most, ranked by units sold.',
    params: { sortBy: 'best_selling' },
  },
};

/**
 * A ready-made product list (New arrivals, Best sellers) with "Load more".
 * For filtering and searching, the Shop page is the place; this links there.
 * Routes render it with key={kind}, so switching collections starts fresh.
 */
const Collection = ({ kind }) => {
  const config = COLLECTIONS[kind];
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProducts({ ...config.params, page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.products ?? []).map(mapProductForCard);
        setProducts((prev) => (page === 1 ? rows : [...prev, ...rows]));
        setHasNext(Boolean(res?.metaData?.hasNext));
        setStatus(page === 1 && rows.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        console.error(`Failed to load ${kind}:`, err);
        if (!cancelled && page === 1) setStatus('error');
      })
      .finally(() => !cancelled && setLoadingMore(false));
    return () => {
      cancelled = true;
    };
  }, [kind, page, config.params]);

  return (
    <div className="collection">
      <header className="collection__header container">
        <span className="collection__eyebrow">{config.eyebrow}</span>
        <h1>{config.title}</h1>
        <p>{config.lead} Want to filter? <Link to="/shop">Open the shop</Link>.</p>
      </header>
      <section className="container collection__grid">
        <ProductGrid
          status={status}
          products={products}
          skeletonCount={8}
          emptyMessage="No products here yet."
          errorMessage="Couldn't load products right now. Please refresh the page."
        />
        {hasNext && status === 'ready' && (
          <button type="button" className="btn btn-ghost btn-lg collection__more" onClick={() => { setLoadingMore(true); setPage((p) => p + 1); }} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>
    </div>
  );
};

export default Collection;
