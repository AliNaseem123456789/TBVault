import api from "./apiClient";

/**
 * Cart API. Mirrors products.api.js / categories.api.js.
 *
 * Routes confirmed from the real cart.routes.js:
 *   POST   /cart/items            -> addCartItems
 *   GET    /cart                  -> getCartItems
 *   PATCH  /cart/items/:productId -> updateCartItems
 *   DELETE /cart/items/:productId -> deleteCartItems
 *   DELETE /cart                  -> deleteCart (clears everything)
 *
 * cart.controller.js currently reads the target product from
 * `req.body.product_id` (snake_case) in addCartItems/updateCartItems/
 * deleteCartItems — never from req.params.productId, even on the two
 * routes that put it in the URL. So every write below sends
 * `product_id` in the body AND `:productId` in the URL, to satisfy
 * both the route pattern and what the controller actually reads.
 * If updateCartItems/deleteCartItems get changed to read
 * req.params.productId instead (recommended — the URL already
 * uniquely identifies the item), drop the body's product_id here and
 * this file gets simpler.
 *
 * All five handlers read req.user.sub, so every request needs the
 * Bearer token — apiClient.js's request interceptor already attaches
 * it whenever one is in localStorage.
 *
 * getCartItems responds with { message, data: { cart } } where cart
 * comes from prisma.cart.findMany (not findUnique), so `data.cart` is
 * an ARRAY — CartProvider unwraps cart[0] since a user has at most
 * one cart (user_id is @unique on the Cart model).
 */

export const getCart = async () => {
  const response = await api.get("/cart");
  return response.data;
};

export const addCartItem = async (productId, quantity = 1) => {
  const response = await api.post("/cart/items", { product_id: productId, quantity });
  return response.data;
};

export const updateCartItem = async (productId, quantity) => {
  const response = await api.patch(`/cart/items/${productId}`, { product_id: productId, quantity });
  return response.data;
};

export const removeCartItem = async (productId) => {
  const response = await api.delete(`/cart/items/${productId}`, { data: { product_id: productId } });
  return response.data;
};

export const clearCart = async () => {
  const response = await api.delete("/cart");
  return response.data;
};
