import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import ProductGrid from '../../components/ui/ProductGrid';
import { getProducts } from '../../api/products.api';
import { getCategories } from '../../api/categories.api';
import { mapProductForCard } from '../../utils/product';
import './Shop.css';

const PAGE_SIZE = 12;

const SORT_OPTIONS = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'best_selling:desc', label: 'Best selling' },
  { value: 'price:asc', label: 'Price: low to high' },
  { value: 'price:desc', label: 'Price: high to low' },
  { value: 'name:asc', label: 'Name: A to Z' },
  { value: 'name:desc', label: 'Name: Z to A' },
];

/**
 * Full product catalog with search, category/price/stock filters,
 * sorting and pagination — all backed by the real GET /products
 * query params (see products.api.js). Filters live in the URL
 * (via useSearchParams) so results are shareable/bookmarkable and
 * survive the back button, not just component state.
 */
const Shop = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Local copies of the "typed" filters so every keystroke doesn't
  // immediately trigger a URL update / API call — see the debounce
  // effect below.
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [minPriceInput, setMinPriceInput] = useState(searchParams.get('minPrice') || '');
  const [maxPriceInput, setMaxPriceInput] = useState(searchParams.get('maxPrice') || '');

  const categoryId = searchParams.get('categoryId') || '';
  const inStock = searchParams.get('inStock') === 'true';
  const sortKey = `${searchParams.get('sortBy') || 'created_at'}:${searchParams.get('order') || 'desc'}`;
  const page = Number(searchParams.get('page')) || 1;

  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState('loading');
  const [products, setProducts] = useState([]);
  const [meta, setMeta] = useState(null);

  const updateParams = useCallback(
    (patch) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, value]) => {
          if (value === null || value === '' || value === undefined) {
            next.delete(key);
          } else {
            next.set(key, String(value));
          }
        });
        return next;
      });
    },
    [setSearchParams]
  );

  // Debounce the text/number inputs into the URL — this is what
  // actually triggers a fetch (see the effect below).
  useEffect(() => {
    const timeout = setTimeout(() => {
      updateParams({
        search: searchInput.trim() || null,
        minPrice: minPriceInput || null,
        maxPrice: maxPriceInput || null,
        page: null, // any filter change resets pagination to page 1
      });
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchInput, minPriceInput, maxPriceInput, updateParams]);

  // Categories for the filter sidebar — fetched once.
  useEffect(() => {
    getCategories()
      .then((res) => setCategories(res?.data ?? []))
      .catch((err) => {
        console.error('Failed to load categories:', err);
        setCategories([]);
      });
  }, []);

  // Products — refetches whenever the URL's filters actually change.
  useEffect(() => {
    let cancelled = false;
    // Resetting to 'loading' on every filter change (not just on mount)
    // is intentional here, so the grid shows a skeleton while refetching.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');

    const [sortBy, order] = sortKey.split(':');
    const params = { page, limit: PAGE_SIZE, sortBy, order };
    const search = searchParams.get('search');
    const minPrice = searchParams.get('minPrice');
    const maxPrice = searchParams.get('maxPrice');
    if (search) params.search = search;
    if (categoryId) params.categoryId = categoryId;
    if (minPrice) params.minPrice = minPrice;
    if (maxPrice) params.maxPrice = maxPrice;
    if (inStock) params.inStock = 'true';

    getProducts(params)
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.products ?? []).filter((p) => !p.is_hidden);
        setProducts(rows.map(mapProductForCard));
        setMeta(res?.metaData ?? null);
        setStatus(rows.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        console.error('Failed to load products:', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const hasActiveFilters = Boolean(
    searchParams.get('search') || categoryId || searchParams.get('minPrice') || searchParams.get('maxPrice') || inStock
  );

  const clearFilters = () => {
    setSearchInput('');
    setMinPriceInput('');
    setMaxPriceInput('');
    setSearchParams({});
  };

  const rangeStart = meta ? (meta.currentPage - 1) * meta.itemsPerPage + 1 : 0;
  const rangeEnd = meta ? Math.min(meta.currentPage * meta.itemsPerPage, meta.totalItems) : 0;

  return (
    <div className="shop container">
      <div className="shop__header">
        <h1>Shop all products</h1>
        <p>Browse the full catalog — filter by category, price, or availability.</p>

        <div className="shop__search">
          <Icon name="search" size={18} />
          <input
            type="search"
            className="input"
            placeholder="Search products..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search products"
          />
        </div>
      </div>

      <aside className="shop__filters">
        <div className="filter-group">
          <h3>Category</h3>
          <div className="filter-options">
            <button
              type="button"
              className={`filter-option ${categoryId === '' ? 'is-active' : ''}`}
              onClick={() => updateParams({ categoryId: null, page: null })}
            >
              All categories
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`filter-option ${categoryId === String(cat.id) ? 'is-active' : ''}`}
                onClick={() => updateParams({ categoryId: cat.id, page: null })}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <h3>Price</h3>
          <div className="price-range">
            <input
              type="number"
              min="0"
              className="input"
              placeholder="Min"
              value={minPriceInput}
              onChange={(e) => setMinPriceInput(e.target.value)}
              aria-label="Minimum price"
            />
            <span>–</span>
            <input
              type="number"
              min="0"
              className="input"
              placeholder="Max"
              value={maxPriceInput}
              onChange={(e) => setMaxPriceInput(e.target.value)}
              aria-label="Maximum price"
            />
          </div>
        </div>

        <div className="filter-group">
          <h3>Availability</h3>
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={inStock}
              onChange={(e) => updateParams({ inStock: e.target.checked ? 'true' : null, page: null })}
            />
            In stock only
          </label>
        </div>

        {hasActiveFilters && (
          <button type="button" className="btn btn-ghost btn-sm shop__clear" onClick={clearFilters}>
            Clear all filters
          </button>
        )}
      </aside>

      <div className="shop__results">
        <div className="shop__toolbar">
          <span className="shop__count">
            {status === 'ready' && meta ? `Showing ${rangeStart}–${rangeEnd} of ${meta.totalItems}` : ' '}
          </span>
          <label className="shop__sort">
            Sort by
            <select
              value={sortKey}
              onChange={(e) => {
                const [sortBy, order] = e.target.value.split(':');
                updateParams({ sortBy, order, page: null });
              }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ProductGrid
          status={status}
          products={products}
          skeletonCount={PAGE_SIZE}
          emptyMessage={
            hasActiveFilters
              ? 'No products match these filters. Try adjusting or clearing them.'
              : 'No products yet — check back soon.'
          }
          errorMessage="Couldn't reach the product catalog right now. Make sure the API is running."
        />

        {status === 'ready' && meta && meta.totalPages > 1 && (
          <div className="shop__pagination">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!meta.hasPrev}
              onClick={() => updateParams({ page: page - 1 })}
            >
              Previous
            </button>
            <span>
              Page {meta.currentPage} of {meta.totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!meta.hasNext}
              onClick={() => updateParams({ page: page + 1 })}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Shop;
