import api from "./apiClient";

/**
 * Products API (public storefront; hidden products are never returned).
 *
 *   GET /products      params: { search, categoryId, minPrice, maxPrice, inStock, onSale,
 *                      ids ("1,2,3"), sortBy, order, page, limit }
 *                      -> { data: { products }, metaData: { totalPages, currentPage,
 *                         hasNext, hasPrev, itemsPerPage, totalItems } }
 *   GET /products/:id  -> { data: { product } } with category, all images (primary first)
 *                      and active variants.
 *   GET /products/:id/related
 *
 * Every product carries sale_price / sale_percent / sale_ends_at (null when not on
 * sale); variants carry effective_list_price and sale_price.
 * Admin create/update/delete lives in admin.api.js.
 */

export const getProducts = async (params = {}) => {
  const response = await api.get("/products", { params });
  return response.data;
};

export const getProductById = async (id) => {
  const response = await api.get(`/products/${id}`);
  return response.data;
};

export const getRelatedProducts = async (id, limit = 4) => {
  const response = await api.get(`/products/${id}/related`, { params: { limit } });
  return response.data;
};
