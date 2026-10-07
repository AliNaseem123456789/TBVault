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

export const getOrder = async (orderId) => {
  const response = await api.get(`/admin/orders/${orderId}`);
  return response.data;
};

// status, plus optional { note, tracking_carrier, tracking_number, tracking_url }
export const changeOrderStatus = async (orderId, body) => {
  const response = await api.patch(`/admin/orders/${orderId}/status`, body);
  return response.data;
};

export const updateOrderTracking = async (orderId, body) => {
  const response = await api.patch(`/admin/orders/${orderId}/tracking`, body);
  return response.data;
};

// amount omitted = refund everything not yet refunded
export const refundOrder = async (orderId, { amount, reason } = {}) => {
  const response = await api.post(`/admin/orders/${orderId}/refunds`, { amount, reason });
  return response.data;
};

// ---------- Variants ----------
export const listVariants = async (productId) => {
  const response = await api.get(`/admin/products/${productId}/variants`);
  return response.data;
};

export const createVariant = async (productId, data) => {
  const response = await api.post(`/products/${productId}/variants`, data);
  return response.data;
};

export const updateVariant = async (variantId, data) => {
  const response = await api.put(`/variants/${variantId}`, data);
  return response.data;
};

export const deleteVariant = async (variantId) => {
  await api.delete(`/variants/${variantId}`);
};

// ---------- Sales ----------
export const listSales = async () => {
  const response = await api.get("/admin/sales");
  return response.data;
};

export const createSale = async (data) => {
  const response = await api.post("/admin/sales", data);
  return response.data;
};

export const updateSale = async (saleId, data) => {
  const response = await api.put(`/admin/sales/${saleId}`, data);
  return response.data;
};

export const deleteSale = async (saleId) => {
  await api.delete(`/admin/sales/${saleId}`);
};

// ---------- Coupons ----------
export const listCoupons = async (params = {}) => {
  const response = await api.get("/admin/coupons", { params });
  return response.data;
};

export const createCoupon = async (data) => {
  const response = await api.post("/admin/coupons", data);
  return response.data;
};

export const updateCoupon = async (couponId, data) => {
  const response = await api.put(`/admin/coupons/${couponId}`, data);
  return response.data;
};

export const setCouponActive = async (couponId, isActive) => {
  const response = await api.patch(`/admin/coupons/${couponId}/status`, { is_active: isActive });
  return response.data;
};

export const deleteCoupon = async (couponId) => {
  await api.delete(`/admin/coupons/${couponId}`);
};

export const getCouponRedemptions = async (couponId) => {
  const response = await api.get(`/admin/coupons/${couponId}/redemptions`);
  return response.data;
};

// ---------- Returns ----------
export const listReturns = async (params = {}) => {
  const response = await api.get("/admin/returns", { params });
  return response.data;
};

// status: APPROVED | REJECTED | RECEIVED, plus optional admin_note and restock
export const updateReturn = async (returnId, body) => {
  const response = await api.patch(`/admin/returns/${returnId}`, body);
  return response.data;
};

export const refundReturn = async (returnId, amount) => {
  const response = await api.post(`/admin/returns/${returnId}/refund`, { amount });
  return response.data;
};

// ---------- Customers ----------
export const listCustomers = async (params = {}) => {
  const response = await api.get("/admin/customers", { params });
  return response.data;
};

export const getCustomer = async (userId) => {
  const response = await api.get(`/admin/customers/${userId}`);
  return response.data;
};

export const setCustomerBlocked = async (userId, blocked) => {
  const response = await api.patch(`/admin/customers/${userId}/block`, { blocked });
  return response.data;
};

// ---------- Reviews ----------
export const listReviews = async (params = {}) => {
  const response = await api.get("/admin/reviews", { params });
  return response.data;
};

export const setReviewHidden = async (reviewId, isHidden) => {
  const response = await api.patch(`/admin/reviews/${reviewId}/visibility`, { is_hidden: isHidden });
  return response.data;
};

export const deleteReview = async (reviewId) => {
  await api.delete(`/reviews/${reviewId}`);
};

// ---------- Settings & shipping ----------
export const getSettings = async () => {
  const response = await api.get("/admin/settings");
  return response.data;
};

export const saveSettings = async (data) => {
  const response = await api.put("/admin/settings", data);
  return response.data;
};

export const listShippingZones = async () => {
  const response = await api.get("/admin/shipping-zones");
  return response.data;
};

export const createShippingZone = async (data) => {
  const response = await api.post("/admin/shipping-zones", data);
  return response.data;
};

export const updateShippingZone = async (zoneId, data) => {
  const response = await api.put(`/admin/shipping-zones/${zoneId}`, data);
  return response.data;
};

export const deleteShippingZone = async (zoneId) => {
  await api.delete(`/admin/shipping-zones/${zoneId}`);
};

// ---------- Dashboard & exports ----------
export const getDashboard = async (days = 30) => {
  const response = await api.get("/admin/analytics", { params: { days } });
  return response.data;
};

/**
 * Downloads a CSV export. It goes through axios (not a plain link) because the
 * request needs the admin's Bearer token.
 */
export const downloadExport = async (kind, params = {}) => {
  const response = await api.get(`/admin/exports/${kind}.csv`, { params, responseType: "blob" });
  const disposition = response.headers["content-disposition"] ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${kind}.csv`;
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
