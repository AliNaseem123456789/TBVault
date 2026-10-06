import api from "./apiClient";

export const login=async(email,password)=>{
    const response=await api.post("/auth/login",{email,password})
    return response.data;
}
export const register=async(name,email,password,confirmPassword)=>{
    const response=await api.post("/auth/register",{name,email,password,confirmPassword})
    return response.data;
}
export const logout=async()=>{
    const response=await api.post("/auth/logout")
    return response.data;
}
export const logoutAll=async()=>{
    const response=await api.post("/auth/logout-all")
    return response.data;
}
export const refresh=async()=>{
    const response=await api.post("/auth/refresh")
    return response.data;
}
export const forgotPassword = async (email) => {
  const response = await api.post("/auth/forgot-password", { email });
  return response.data;
};

export const resetPassword = async (token, password, confirmPassword) => {
  const response = await api.post(`/auth/reset-password?token=${encodeURIComponent(token)}`, { password, confirmPassword });
  return response.data;
};

// The backend reads the account from the access token; no email is sent.
export const verifyEmail = async () => {
  const response = await api.post("/auth/verify-email");
  return response.data;
};

export const confirmEmail = async (token) => {
  const response = await api.post(`/auth/confirm-email?token=${token}`);
  return response.data;
};
export const me = async () => {
  const response = await api.get("/auth/me");
  return response.data;
};

export const updateMe = async ({ name }) => {
  const response = await api.patch("/auth/me", { name });
  return response.data;
};

// Returns a fresh accessToken: every other session is signed out.
export const changePassword = async ({ currentPassword, newPassword, confirmPassword }) => {
  const response = await api.post("/auth/change-password", { currentPassword, newPassword, confirmPassword });
  return response.data;
};
