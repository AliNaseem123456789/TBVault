import api from "./apiClient";

/**
 * Orders API.
 *
 *   POST /order/quote                  live totals for checkout (guests send items, customers use their cart)
 *   POST /order                        signed-in checkout, header Idempotency-Key
 *   POST /order/guest                  guest checkout, header Idempotency-Key
 *   GET  /order                        the signed-in customer's orders
 *   GET  /order-details/:order_id      one of them (with timeline, refunds, returns)
 *   POST /orders/:orderId/cancel
 *   POST /orders/:orderId/pay          new Stripe Checkout link for an unpaid card order
 *   POST /orders/:orderId/returns      request a return
 *
 * Tracking without an account (guests, or anyone with the link):
 *   POST /order/track                  { order_id, email } -> { token }
 *   GET  /order/track/:token
 *   POST /order/track/:token/cancel | /pay | /returns
 *
 * Card orders respond with data.checkout_url: send the browser there to pay.
 */

export const quoteOrder = async (body) => {
  const response = await api.post("/order/quote", body);
  return response.data;
};

export const getOrders = async () => {
  const response = await api.get("/order");
  return response.data;
};

export const getOrderById = async (orderId) => {
  const response = await api.get(`/order-details/${orderId}`);
  return response.data;
};

// body: { address_id | address, coupon_code?, payment_method: "cod" | "card" }
export const createOrder = async (body, idempotencyKey) => {
  const response = await api.post("/order", body, { headers: { "Idempotency-Key": idempotencyKey } });
  return response.data;
};

// body: { email, items, address, coupon_code?, payment_method }
export const createGuestOrder = async (body, idempotencyKey) => {
  const response = await api.post("/order/guest", body, { headers: { "Idempotency-Key": idempotencyKey } });
  return response.data;
};

export const cancelOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/cancel`);
  return response.data;
};

export const payOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/pay`);
  return response.data;
};

export const requestReturn = async (orderId, body) => {
  const response = await api.post(`/orders/${orderId}/returns`, body);
  return response.data;
};

export const lookupOrder = async (orderId, email) => {
  const response = await api.post("/order/track", { order_id: orderId, email });
  return response.data;
};

export const getOrderByToken = async (token) => {
  const response = await api.get(`/order/track/${token}`);
  return response.data;
};

export const cancelOrderByToken = async (token) => {
  const response = await api.post(`/order/track/${token}/cancel`);
  return response.data;
};

export const payOrderByToken = async (token) => {
  const response = await api.post(`/order/track/${token}/pay`);
  return response.data;
};

export const requestReturnByToken = async (token, body) => {
  const response = await api.post(`/order/track/${token}/returns`, body);
  return response.data;
};
