import api from "./apiClient";

/**
 * Orders API.
 *
 *   POST /order                    -> createOrder   body: { shipping_address }, header: Idempotency-Key
 *   GET  /order                    -> getOrders     (current user's orders, newest first)
 *   GET  /order-details/:order_id  -> getOrderById  (only the owner's orders; 404 otherwise)
 *   POST /orders/:orderId/cancel   -> cancelOrder
 *
 * createOrder reads the cart from the DB server-side, checks stock, creates the
 * order and empties the cart in one transaction. The Idempotency-Key makes a
 * retried or double-submitted request return the first order instead of
 * creating a second one.
 */

export const getOrders = async () => {
  const response = await api.get("/order");
  return response.data;
};

export const getOrderById = async (orderId) => {
  const response = await api.get(`/order-details/${orderId}`);
  return response.data;
};

export const createOrder = async (shippingAddress, idempotencyKey) => {
  const response = await api.post(
    "/order",
    { shipping_address: shippingAddress },
    { headers: { "Idempotency-Key": idempotencyKey } }
  );
  return response.data;
};

export const cancelOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/cancel`);
  return response.data;
};
