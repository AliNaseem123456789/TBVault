import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getWishlist, addToWishlist, removeFromWishlist } from '../../api/wishlist.api';

const WishlistContext = createContext(null);

/**
 * Which products the signed-in customer has saved, so every heart button
 * (product cards, product page) shows the same state. Guests are sent to
 * sign in when they tap a heart.
 */
export const WishlistProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setItems([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const res = await getWishlist();
      setItems(res?.data?.items ?? []);
      setStatus('ready');
    } catch (err) {
      console.error('Failed to load wishlist:', err);
      setStatus('error');
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ids = useMemo(() => new Set(items.map((i) => i.product.id)), [items]);

  const toggle = useCallback(
    async (productId) => {
      if (!isAuthenticated) {
        navigate('/login', { state: { from: window.location.pathname } });
        return;
      }
      // Optimistic: flip the heart now, reload the real list after.
      if (ids.has(productId)) {
        setItems((prev) => prev.filter((i) => i.product.id !== productId));
        await removeFromWishlist(productId).catch((err) => console.error(err));
      } else {
        setItems((prev) => [...prev, { id: `tmp-${productId}`, product: { id: productId } }]);
        await addToWishlist(productId).catch((err) => console.error(err));
      }
      refresh();
    },
    [isAuthenticated, ids, navigate, refresh]
  );

  const value = useMemo(
    () => ({ items, status, isSaved: (id) => ids.has(id), toggle, refresh, count: ids.size }),
    [items, status, ids, toggle, refresh]
  );
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useWishlist = () => useContext(WishlistContext);
