import api from "./apiClient";

/**
 * Products API (public storefront; hidden products are never returned).
 *
 *   GET /products      params: { search, categoryId, minPrice, maxPrice, inStock,
 *                      sortBy, order, page, limit }
 *                      -> { data: { products }, metaData: { totalPages, currentPage,
 *                         hasNext, hasPrev, itemsPerPage, totalItems } }
 *                      Each product includes category { id, name } and up to two
 *                      images, primary first.
 *   GET /products/:id  -> { data: { product } } with category and all images, primary first.
 *
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
