import api from "./apiClient";

/**
 * Orders API. Mirrors products.api.js / categories.api.js / cart.api.js.
 *
 * Routes confirmed from the real orders.routes.js:
 *   POST /order                    -> createOrder    body: { shipping_address }
 *   GET  /order                    -> getOrders       (current user's orders)
 *   GET  /order-details/:order_id  -> getOrderById
 *   POST /orders/:id/cancel        -> cancelOrder
 *
 * Yes, /order (singular) for create/list vs /orders/:id/cancel
 * (plural) for cancel, and get-by-id living at a separate
 * /order-details path — that's really how the backend has it, not a
 * typo here.
 *
 * cancelOrder itself is broken as currently routed: the handler reads
 * req.params.orderId, but the route names the segment :id, so
 * req.params.orderId is always undefined server-side and every cancel
 * 400s regardless of what's sent here. Flagged to fix by renaming the
 * route to /orders/:orderId/cancel (one-word change, no controller
 * edit needed) — this file already sends the id in the URL either
 * way, so nothing changes here once that's fixed.
 *
 * createOrder reads the cart straight from the DB server-side (not
 * from the request body) — it just needs a shipping_address string,
 * checks stock, creates the Order + OrderItems, decrements stock, and
 * empties the cart, all in one transaction. So after a successful
 * call here, CartProvider's refresh() will correctly show an empty
 * cart with no extra work.
 *
 * getOrderById's response includes each item's product (with its
 * primary image) — createOrder's and cancelOrder's responses don't
 * (their Prisma `include` is shallower), so after placing or
 * cancelling an order, re-fetch via getOrderById for the rich view
 * rather than relying on those two responses' `items`.
 *
 * Also worth flagging in the controller itself: getOrderById doesn't
 * scope its findUnique by user_id (unlike cancelOrder, which does) —
 * as written, any authenticated user who guesses/increments an order
 * id can view another user's order, including their shipping address.
 * Recommend adding `user_id` to that where clause.
 */

export const getOrders = async () => {
  const response = await api.get("/order");
  return response.data;
};

export const getOrderById = async (orderId) => {
  const response = await api.get(`/order-details/${orderId}`);
  return response.data;
};

export const createOrder = async (shippingAddress) => {
  const response = await api.post("/order", { shipping_address: shippingAddress });
  return response.data;
};

export const cancelOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/cancel`);
  return response.data;
};
