import api from "./apiClient";

export const getWishlist = async () => {
  const response = await api.get("/wishlist");
  return response.data;
};

export const addToWishlist = async (productId) => {
  const response = await api.post("/wishlist/items", { product_id: productId });
  return response.data;
};

export const removeFromWishlist = async (productId) => {
  await api.delete(`/wishlist/items/${productId}`);
};
