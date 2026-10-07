import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getCart, addCartItem, updateCartItem, removeCartItem, clearCart, mergeCart } from '../../api/cart.api';
import { getProductById } from '../../api/products.api';
import { unitPrice } from '../../utils/product';

const CartContext = createContext(null);
const GUEST_KEY = 'tbvault.guestCart';

// localStorage can throw (private mode, blocked storage); the cart then just lives in memory.
const readGuestCart = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeGuestCart = (items) => {
  try {
    if (items.length) localStorage.setItem(GUEST_KEY, JSON.stringify(items));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage unavailable */
  }
};

const guestKey = (productId, variantId) => `${productId}:${variantId ?? ''}`;

// Keeps only what the cart drawer and checkout need, so localStorage stays small.
const productSnapshot = (p) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  sale_price: p.sale_price ?? null,
  sale_percent: p.sale_percent ?? null,
  stock: p.stock,
  images: (p.images ?? []).slice(0, 1).map((img) => ({ key: img.key })),
});

/**
 * Global cart state — sits inside AuthProvider (needs isAuthenticated)
 * and outside <Routes> in App.jsx so the Navbar's cart icon and every
 * page share one source of truth. <CartDrawer /> (rendered once, in
 * Layout.jsx) reads isOpen.
 *
 * Two modes, same shape for consumers:
 *   - signed in: the cart lives on the server (GET /cart)
 *   - guest: the cart lives in localStorage, with a small product
 *     snapshot per line for display. Checkout re-prices it server-side
 *     (POST /order/quote), so a stale snapshot never decides a price.
 * When a guest signs in, their browser cart is merged into their
 * account (POST /cart/merge) and cleared locally.
 *
 * Every item: { id, product_id, variant_id, quantity, product, variant }.
 */
export const CartProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState(() => (isAuthenticated ? [] : readGuestCart().map((i) => ({ ...i, id: guestKey(i.product_id, i.variant_id) }))));
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const merging = useRef(false);

  const setGuestItems = useCallback((next) => {
    // `id` is only for React keys; it isn't stored.
    writeGuestCart(next.map((item) => {
      const stored = { ...item };
      delete stored.id;
      return stored;
    }));
    setItems(next.map((i) => ({ ...i, id: guestKey(i.product_id, i.variant_id) })));
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setItems(readGuestCart().map((i) => ({ ...i, id: guestKey(i.product_id, i.variant_id) })));
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const res = await getCart();
      // cart comes from findMany, so it's an array even though a user has at most one.
      const carts = res?.data?.cart;
      const cart = Array.isArray(carts) ? carts[0] : carts;
      setItems(cart?.items ?? []);
      setStatus('ready');
    } catch (err) {
      console.error('Failed to load cart:', err);
      setItems([]);
      setStatus('error');
    }
  }, [isAuthenticated]);

  // On sign-in: move the guest cart into the account, then load it.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const guestItems = readGuestCart();
      if (isAuthenticated && guestItems.length && !merging.current) {
        merging.current = true;
        try {
          const res = await mergeCart(guestItems.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity })));
          writeGuestCart([]);
          const skipped = res?.data?.skipped?.length ?? 0;
          if (!cancelled && skipped) setNotice(`${skipped} item${skipped === 1 ? " wasn't" : "s weren't"} available any more and were left out.`);
        } catch (err) {
          console.error('Failed to merge guest cart:', err);
        } finally {
          merging.current = false;
        }
      }
      if (!cancelled) await refresh();
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, refresh]);

  /**
   * addItem(productId, quantity, { variantId, product, variant })
   * `product`/`variant` are only used as the guest-cart snapshot; when a
   * guest adds without them (Quick add), the product is fetched once.
   */
  const addItem = useCallback(
    async (productId, quantity = 1, { variantId = null, product = null, variant = null } = {}) => {
      if (isAuthenticated) {
        await addCartItem(productId, quantity, variantId);
        await refresh();
      } else {
        let full = product;
        if (!full) full = (await getProductById(productId))?.data?.product;
        const chosenVariant = variant ?? (variantId ? full?.variants?.find((v) => v.id === variantId) : null);
        const current = readGuestCart();
        const key = guestKey(productId, variantId);
        const existing = current.find((i) => guestKey(i.product_id, i.variant_id) === key);
        const next = existing
          ? current.map((i) => (i === existing ? { ...i, quantity: Math.min(99, i.quantity + quantity) } : i))
          : [
              ...current,
              {
                product_id: productId,
                variant_id: variantId,
                quantity: Math.min(99, quantity),
                product: productSnapshot(full),
                variant: chosenVariant
                  ? { id: chosenVariant.id, name: chosenVariant.name, stock: chosenVariant.stock, effective_list_price: chosenVariant.effective_list_price, sale_price: chosenVariant.sale_price ?? null }
                  : null,
              },
            ];
        setGuestItems(next);
      }
      setIsOpen(true);
    },
    [isAuthenticated, refresh, setGuestItems]
  );

  const updateItem = useCallback(
    async (productId, quantity, variantId = null) => {
      if (isAuthenticated) {
        await updateCartItem(productId, quantity, variantId);
        await refresh();
        return;
      }
      const key = guestKey(productId, variantId);
      setGuestItems(readGuestCart().map((i) => (guestKey(i.product_id, i.variant_id) === key ? { ...i, quantity } : i)));
    },
    [isAuthenticated, refresh, setGuestItems]
  );

  const removeItem = useCallback(
    async (productId, variantId = null) => {
      if (isAuthenticated) {
        await removeCartItem(productId, variantId);
        await refresh();
        return;
      }
      const key = guestKey(productId, variantId);
      setGuestItems(readGuestCart().filter((i) => guestKey(i.product_id, i.variant_id) !== key));
    },
    [isAuthenticated, refresh, setGuestItems]
  );

  const clear = useCallback(async () => {
    if (isAuthenticated) {
      await clearCart();
      await refresh();
    } else {
      setGuestItems([]);
    }
  }, [isAuthenticated, refresh, setGuestItems]);

  const count = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  // Display only; checkout asks the server for the real total (coupons, shipping, tax).
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + Number(unitPrice(item.product, item.variant).price) * item.quantity, 0),
    [items]
  );

  const value = useMemo(
    () => ({
      items,
      status,
      count,
      subtotal,
      isOpen,
      isGuest: !isAuthenticated,
      notice,
      dismissNotice: () => setNotice(''),
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      addItem,
      updateItem,
      removeItem,
      clear,
      // Re-fetches without going through addItem/updateItem/etc. — for when
      // something outside this context already changed the cart (placing an
      // order empties it server-side).
      refresh,
    }),
    [items, status, count, subtotal, isOpen, isAuthenticated, notice, addItem, updateItem, removeItem, clear, refresh]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useCart = () => useContext(CartContext);
