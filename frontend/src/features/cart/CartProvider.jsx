import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getCart, addCartItem, updateCartItem, removeCartItem, clearCart } from '../../api/cart.api';

const CartContext = createContext(null);

/**
 * Global cart state — sits inside AuthProvider (needs isAuthenticated)
 * and outside <Routes> in App.jsx so both the Navbar's cart icon and
 * every page (ProductCard's "Quick add", ProductDetail's "Add to
 * cart") share one source of truth instead of each fetching its own
 * copy. <CartDrawer /> (rendered once, in Layout.jsx) reads isOpen.
 *
 * getCartItems responds with { data: { cart } } where cart is an
 * array of carts (see cart.api.js's doc comment on the findMany
 * quirk) — `items` here is always that one cart's CartItem[] (each
 * with a nested `product`, pre-fetched with its primary image),
 * never the raw response.
 */
export const CartProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [isOpen, setIsOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!isAuthenticated) {
      setItems([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    getCart()
      .then((res) => {
        // res.data = { cart: [...] } — cart comes from findMany, so
        // it's an array even though a user has at most one.
        const carts = res?.data?.cart;
        const cart = Array.isArray(carts) ? carts[0] : carts;
        setItems(cart?.items ?? []);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load cart:', err);
        setItems([]);
        setStatus('error');
      });
  }, [isAuthenticated]);

  // Refetch whenever auth state changes (refresh() itself depends on
  // isAuthenticated) — deliberate synchronous setState-in-effect, same
  // pattern as Shop.jsx / ProductDetail.jsx's refetch effects.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (productId, quantity = 1) => {
      await addCartItem(productId, quantity);
      refresh();
      setIsOpen(true);
    },
    [refresh]
  );

  const updateItem = useCallback(
    async (productId, quantity) => {
      await updateCartItem(productId, quantity);
      refresh();
    },
    [refresh]
  );

  const removeItem = useCallback(
    async (productId) => {
      await removeCartItem(productId);
      refresh();
    },
    [refresh]
  );

  const clear = useCallback(async () => {
    await clearCart();
    refresh();
  }, [refresh]);

  const count = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.product?.price ?? 0) * item.quantity, 0),
    [items]
  );

  const value = useMemo(
    () => ({
      items,
      status,
      count,
      subtotal,
      isOpen,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      addItem,
      updateItem,
      removeItem,
      clear,
      // Re-fetches without going through addItem/updateItem/etc. — for
      // when something OUTSIDE this context already changed the cart
      // server-side (createOrder empties it as part of placing an
      // order) and a page just needs local state to catch up.
      refresh,
    }),
    [items, status, count, subtotal, isOpen, addItem, updateItem, removeItem, clear, refresh]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => useContext(CartContext);
