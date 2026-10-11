import api from "./apiClient";

/** Brands, stores and seller accounts. */

// ---------- Brands ----------
export const getBrands = async () => (await api.get("/brands")).data;
export const createBrand = async (name) => (await api.post("/admin/brands", { name })).data;
export const renameBrand = async (id, name) => (await api.put(`/admin/brands/${id}`, { name })).data;
export const deleteBrand = async (id) => {
  await api.delete(`/admin/brands/${id}`);
};

// ---------- Public store pages ----------
export const listStores = async () => (await api.get("/stores")).data;
export const getStore = async (slug) => (await api.get(`/stores/${slug}`)).data;

// ---------- Becoming / being a seller ----------
export const applyToSell = async (data) => (await api.post("/seller/apply", data)).data;
export const getMySeller = async () => (await api.get("/seller/me")).data;
export const updateMySeller = async (data) => (await api.patch("/seller/me", data)).data;
export const getSellerDashboard = async () => (await api.get("/seller/dashboard")).data;
export const getSellerTransactions = async (params = {}) => (await api.get("/seller/transactions", { params })).data;
export const listSellerOrders = async (params = {}) => (await api.get("/seller/orders", { params })).data;
export const updateSellerOrderStatus = async (shipmentId, body) => (await api.patch(`/seller/orders/${shipmentId}/status`, body)).data;

// ---------- Admin: sellers ----------
export const listSellers = async (params = {}) => (await api.get("/admin/sellers", { params })).data;
export const getSellerAdmin = async (id) => (await api.get(`/admin/sellers/${id}`)).data;
export const setSellerStatus = async (id, status, note) => (await api.patch(`/admin/sellers/${id}/status`, { status, note })).data;
export const updateSellerAdmin = async (id, data) => (await api.patch(`/admin/sellers/${id}`, data)).data;
export const createSellerPayout = async (id, data) => (await api.post(`/admin/sellers/${id}/payouts`, data)).data;
export const getSellerTransactionsAdmin = async (id, params = {}) => (await api.get(`/admin/sellers/${id}/transactions`, { params })).data;
