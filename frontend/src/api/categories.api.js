import api from "./apiClient";

/**
 * Categories API.
 *
 *   GET /categories               -> [{ id, name, created_at, _count: { products } }]
 *                                    (_count only counts visible products)
 *   GET /categories/:id/products  -> { id, name, products: [...] } (visible products only)
 */

export const getCategories = async () => {
  const response = await api.get("/categories");
  return response.data;
};

export const getCategoryProducts = async (id) => {
  const response = await api.get(`/categories/${id}/products`);
  return response.data;
};
