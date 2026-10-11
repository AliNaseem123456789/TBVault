import api from "./apiClient";

/** Store credit. */
export const getWallet = async (params = {}) => (await api.get("/wallet", { params })).data;
export const startTopup = async (amount) => (await api.post("/wallet/topup", { amount })).data;
export const redeemGiftCard = async (code) => (await api.post("/wallet/redeem", { code })).data;

// ---------- Admin ----------
export const getCustomerCredits = async (userId, params = {}) => (await api.get(`/admin/customers/${userId}/credits`, { params })).data;
export const adjustCustomerCredits = async (userId, amount, note) => (await api.post(`/admin/customers/${userId}/credits`, { amount, note })).data;
export const listGiftCards = async (params = {}) => (await api.get("/admin/gift-cards", { params })).data;
export const createGiftCards = async (data) => (await api.post("/admin/gift-cards", data)).data;
export const setGiftCardActive = async (id, isActive) => (await api.patch(`/admin/gift-cards/${id}`, { is_active: isActive })).data;
