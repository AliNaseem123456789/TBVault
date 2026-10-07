import api from "./apiClient";

/** Store-wide settings the storefront needs: name, tax rate, card payments on/off, free-shipping threshold. */
export const getStoreConfig = async () => {
  const response = await api.get("/store/config");
  return response.data;
};

/** Counts this browser once per day, for the admin dashboard's conversion rate. */
export const recordVisit = async (visitorId) => {
  await api.post("/analytics/visits", { visitor_id: visitorId });
};

/** "Email me when it's back." Guests pass an email; signed-in customers don't need to. */
export const createStockAlert = async (productId, { email, variantId } = {}) => {
  const response = await api.post(`/products/${productId}/stock-alerts`, { email, variant_id: variantId });
  return response.data;
};
