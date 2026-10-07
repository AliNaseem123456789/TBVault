import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads an order with `fetcher()` whenever `key` changes and, after Stripe sends
 * the customer back (?payment=success), re-checks for a few seconds until the
 * payment webhook has marked it paid.
 */
export const useOrderLoader = (fetcher, key, { waitForPayment = false } = {}) => {
  const [status, setStatus] = useState('loading'); // loading | ready | notFound | error
  const [order, setOrder] = useState(null);
  // Latest fetcher without re-running the effect on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(async () => {
    try {
      const res = await fetcherRef.current();
      const row = res?.data?.order;
      if (!row) {
        setStatus('notFound');
        return null;
      }
      setOrder(row);
      setStatus('ready');
      return row;
    } catch (err) {
      setStatus(err?.response?.status === 404 ? 'notFound' : 'error');
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer;
    const tick = async () => {
      const row = await load();
      if (!alive) return;
      if (waitForPayment && row?.payment_method === 'card' && row.payment_status === 'unpaid' && tries < 10) {
        tries += 1;
        timer = setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, load, waitForPayment]);

  return { status, order, reload: load };
};
