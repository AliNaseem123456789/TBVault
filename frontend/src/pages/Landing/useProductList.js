import { useEffect, useState } from 'react';
import { getProducts } from '../../api/products.api';
import { mapProductForCard } from '../../utils/product';

/**
 * Loads one list of products for the homepage (best sellers, new arrivals...).
 * `params` go straight to GET /products. Returns { status, products } where
 * status is loading | ready | empty | error and products are ProductCard-shaped.
 * Pass `skip` to wait (e.g. a tab that isn't open yet).
 */
export const useProductList = (params, { skip = false } = {}) => {
  const [state, setState] = useState({ status: 'loading', products: [] });
  const key = JSON.stringify(params);

  useEffect(() => {
    if (skip) return undefined;
    let cancelled = false;
    getProducts(JSON.parse(key))
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.products ?? []).filter((p) => !p.is_hidden);
        setState({ status: rows.length ? 'ready' : 'empty', products: rows.map(mapProductForCard) });
      })
      .catch((err) => {
        console.error('Failed to load products:', err);
        if (!cancelled) setState({ status: 'error', products: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [key, skip]);

  return state;
};
