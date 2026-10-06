import api from "./apiClient";

/**
 * Cart API. Every route needs the Bearer token (apiClient attaches it).
 *
 *   GET    /cart                  -> { data: { cart } }  cart is an array with at most
 *                                    one element; CartProvider reads cart[0]
 *   POST   /cart/items            body: { product_id, quantity }
 *   PATCH  /cart/items/:productId body: { quantity }
 *   DELETE /cart/items/:productId
 *   DELETE /cart                  clears everything
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
