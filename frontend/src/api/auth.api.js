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

export const resetPassword = async (token, email, password) => {
  const response = await api.post(`/auth/reset-password?token=${token}`, { email, password });
  return response.data;
};

export const verifyEmail = async (email) => {
  const response = await api.post("/auth/verify-email", { email });
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