import api from "./apiClient";

/** Admin-only endpoints. The backend checks role=ADMIN on every one of these. */

// ---------- Products ----------
export const listProducts = async (params = {}) => {
  const response = await api.get("/admin/products", { params });
  return response.data;
};

export const getProduct = async (id) => {
  const response = await api.get(`/admin/products/${id}`);
  return response.data;
};

export const createProduct = async (data) => {
  const response = await api.post("/products", data);
  return response.data;
};

export const updateProduct = async (id, data) => {
  const response = await api.put(`/products/${id}`, data);
  return response.data;
};

export const deleteProduct = async (id) => {
  await api.delete(`/products/${id}`);
};

// files: File[]; primaryIndex: which of them becomes the main image (optional)
export const uploadProductImages = async (id, files, primaryIndex) => {
  const form = new FormData();
  files.forEach((file) => form.append("image", file));
  if (primaryIndex !== undefined) form.append("primaryIndex", String(primaryIndex));
  const response = await api.post(`/products/${id}/image`, form);
  return response.data;
};

export const deleteProductImage = async (productId, imageId) => {
  await api.delete(`/products/${productId}/images/${imageId}`);
};

export const setPrimaryImage = async (productId, imageId) => {
  const response = await api.patch(`/products/${productId}/images/${imageId}/primary`);
  return response.data;
};

// ---------- Categories ----------
export const createCategory = async (name) => {
  const response = await api.post("/categories", { name });
  return response.data;
};

export const renameCategory = async (id, name) => {
  const response = await api.put(`/categories/${id}`, { name });
  return response.data;
};

export const deleteCategory = async (id) => {
  await api.delete(`/categories/${id}`);
};

// ---------- Orders ----------
export const listOrders = async (params = {}) => {
  const response = await api.get("/admin/orders", { params });
  return response.data;
};

export const updateOrderStatus = async (orderId, status) => {
  const response = await api.patch(`/admin/orders/${orderId}/status`, { status });
  return response.data;
};
