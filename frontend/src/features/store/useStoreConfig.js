import { useEffect, useState } from 'react';
import { getStoreConfig } from '../../api/store.api';

// Fetched once per page load and shared by every component that asks.
let cached = null;
let pending = null;

const load = () => {
  if (!pending) {
    pending = getStoreConfig()
      .then((res) => {
        cached = res?.data ?? null;
        return cached;
      })
      .catch((err) => {
        console.error('Failed to load store config:', err);
        pending = null;
        return null;
      });
  }
  return pending;
};

/**
 * Store settings for the storefront: { store_name, tax_rate, currency,
 * card_payments_enabled, free_shipping_over, return_window_days, ... }.
 * null until loaded.
 */
export const useStoreConfig = () => {
  const [config, setConfig] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    load().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
};
