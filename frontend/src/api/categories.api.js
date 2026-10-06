import api from "./apiClient";

/**
 * Categories API. Mirrors products.api.js / auth.api.js.
 *
 * Backend note: GET /categories returns [{ id, name, created_at }]
 * — no product count yet. GET /categories/:id/products currently
 * uses findMany (not findUnique) so it resolves to a one-element
 * array; unwrap it as data[0]?.products when that endpoint is used.
 */

export const getCategories = async () => {
  const response = await api.get("/categories");
  return response.data;
};

export const getCategoryProducts = async (id) => {
  const response = await api.get(`/categories/${id}/products`);
  return response.data;
};
