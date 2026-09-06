import axios from "axios";
const Base_URL="http://localhost:3000/api"
const api = axios.create({
  baseURL: Base_URL,
  withCredentials: true
});

// -------------------------
// REQUEST INTERCEPTOR
// -------------------------
api.interceptors.request.use((config) => {
  const token =localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization =
      `Bearer ${token}`;
  }
  return config;
});
// -------------------------
// REFRESH LOCK
// -------------------------
let refreshPromise = null;
async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise =api.post("/auth/refresh")
        .then((response) => {
          const token =response.data.data.accessToken;
          localStorage.setItem(
            "accessToken",
            token
          );
          return token;
        })
        .finally(() => {
          refreshPromise = null;
        });
  }
  return refreshPromise;
}
// -------------------------
// RESPONSE INTERCEPTOR
// -------------------------
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest =error.config;
    if (
      error.response?.status !== 401 ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;
    try {
      const newAccessToken =await refreshAccessToken();
      originalRequest.headers.Authorization =`Bearer ${newAccessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      localStorage.removeItem(
        "accessToken"
      );
      // later:
      // redirect to login
      // clear auth state
      return Promise.reject(refreshError);
    }
  }
);
export default api;