import axios from "axios";
// Set VITE_API_URL in frontend/.env for other environments.
const Base_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api"
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
// Auth endpoints that legitimately return 401 (bad password, expired refresh
// cookie). Retrying them through a refresh makes no sense.
const NO_REFRESH = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/change-password"];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = NO_REFRESH.some((path) => originalRequest?.url?.includes(path));

    if (error.response?.status !== 401 || originalRequest._retry || isAuthEndpoint) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;
    try {
      const newAccessToken = await refreshAccessToken();
      // Let AuthProvider keep React state in sync with localStorage.
      window.dispatchEvent(new CustomEvent("auth:token", { detail: newAccessToken }));
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      localStorage.removeItem("accessToken");
      // Session is gone for good: AuthProvider clears its state and ProtectedRoute sends the user to /login.
      window.dispatchEvent(new Event("auth:logout"));
      return Promise.reject(refreshError);
    }
  }
);
export default api;
