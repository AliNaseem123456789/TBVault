import api from "./apiClient";

/**
 * Cart API (signed-in customers; guests keep their cart in the browser,
 * see CartProvider). Every route needs the Bearer token.
 *
 *   GET    /cart                                   -> { data: { cart } }  cart is an array with at
 *                                                     most one element; items include product + variant
 *   POST   /cart/items                             body: { product_id, variant_id?, quantity }
 *   PATCH  /cart/items/:productId?variantId=       body: { quantity }
 *   DELETE /cart/items/:productId?variantId=
 *   DELETE /cart                                   clears everything
 *   POST   /cart/merge                             body: { items } — the guest cart, after login
 */
const variantParams = (variantId) => (variantId ? { params: { variantId } } : {});

export const getCart = async () => {
  const response = await api.get("/cart");
  return response.data;
};

export const addCartItem = async (productId, quantity = 1, variantId = null) => {
  const response = await api.post("/cart/items", { product_id: productId, variant_id: variantId, quantity });
  return response.data;
};

export const updateCartItem = async (productId, quantity, variantId = null) => {
  const response = await api.patch(`/cart/items/${productId}`, { quantity }, variantParams(variantId));
  return response.data;
};

export const removeCartItem = async (productId, variantId = null) => {
  const response = await api.delete(`/cart/items/${productId}`, variantParams(variantId));
  return response.data;
};

export const clearCart = async () => {
  const response = await api.delete("/cart");
  return response.data;
};

export const mergeCart = async (items) => {
  const response = await api.post("/cart/merge", { items });
  return response.data;
};
