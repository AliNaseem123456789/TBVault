import api from "./apiClient";

/** Saved shipping addresses (signed-in customers). Default address comes first. */
export const getAddresses = async () => {
  const response = await api.get("/addresses");
  return response.data;
};

export const createAddress = async (address) => {
  const response = await api.post("/addresses", address);
  return response.data;
};

export const updateAddress = async (id, address) => {
  const response = await api.put(`/addresses/${id}`, address);
  return response.data;
};

export const setDefaultAddress = async (id) => {
  const response = await api.patch(`/addresses/${id}/default`);
  return response.data;
};

export const deleteAddress = async (id) => {
  await api.delete(`/addresses/${id}`);
};
