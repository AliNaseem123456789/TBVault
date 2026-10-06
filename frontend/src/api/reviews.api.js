import api from "./apiClient";

export const getProductReviews = async (productId, params = {}) => {
  const response = await api.get(`/products/${productId}/reviews`, { params });
  return response.data;
};

// Logged-in only: { canReview, purchased, review }
export const getReviewEligibility = async (productId) => {
  const response = await api.get(`/products/${productId}/reviews/eligibility`);
  return response.data;
};

export const createReview = async (productId, { rating, comment }) => {
  const response = await api.post(`/products/${productId}/reviews`, { rating, comment });
  return response.data;
};

export const updateReview = async (reviewId, { rating, comment }) => {
  const response = await api.patch(`/reviews/${reviewId}`, { rating, comment });
  return response.data;
};

export const deleteReview = async (reviewId) => {
  await api.delete(`/reviews/${reviewId}`);
};

export const getFeaturedReviews = async (limit = 6) => {
  const response = await api.get("/reviews/featured", { params: { limit } });
  return response.data;
};
