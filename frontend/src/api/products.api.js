import api from "./apiClient";

/**
 * Products API. Mirrors the pattern in auth.api.js — thin wrappers
 * around the shared `api` (axios) instance from apiClient.js.
 *
 * GET /products now supports filtering/sorting/pagination — pass any
 * of { search, categoryId, minPrice, maxPrice, inStock, sortBy, order,
 * page, limit } and axios serializes them as query params. Response
 * shape: { message, data: { products }, metaData: { totalPages,
 * currentPage, hasNext, hasPrev, itemsPerPage, totalItems } }. It
 * includes each product's category ({ id, name }) now too.
 *
 * Backend note: GET /products/:id (getProductsById) hasn't been
 * updated the same way yet — it still returns { data: { product } }
 * as a one-element array (via findMany) with no category included.
 * Not used by the frontend yet, so left alone for now.
 */

export const getProducts = async (params = {}) => {
  const response = await api.get("/products", { params });
  return response.data;
};

export const getProductById = async (id) => {
  const response = await api.get(`/products/${id}`);
  return response.data;
};
