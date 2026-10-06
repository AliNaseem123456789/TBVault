import { createContext, useContext, useState, useEffect } from "react";
import { login as loginApi, register as registerApi, logout as logoutApi, me as meApi } from "../../api/auth.api";
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(localStorage.getItem("accessToken"));
  const [user, setUser] = useState(null);

  const fetchUser = async () => {
    try {
      const res = await meApi();
      setUser(res.data);
    } catch (err) {
      console.error("Failed to fetch user:", err);
      setUser(null);
    }
  };

  // on app load, if a token already exists, fetch the user
  useEffect(() => {
    if (accessToken) {
      fetchUser();
    }
  }, []);

  const login = async (email, password) => {
    const res = await loginApi(email, password);
    const token = res.data.accessToken;
    localStorage.setItem("accessToken", token);
    setAccessToken(token);
    await fetchUser();
    return res;
  };

  const signup = async (name, email, password, confirmPassword) => {
    const res = await registerApi(name, email, password, confirmPassword);
    const token = res.data.accessToken;
    localStorage.setItem("accessToken", token);
    setAccessToken(token);
    await fetchUser();
    return res;
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch (err) {
      console.error(err);
    }
    localStorage.removeItem("accessToken");
    setAccessToken(null);
    setUser(null);
  };

  const setToken = async (token) => {
    localStorage.setItem("accessToken", token);
    setAccessToken(token);
    await fetchUser();
  };

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        user,
        isAuthenticated: !!accessToken,
        login,
        signup,
        logout,
        setToken,
        // Re-fetches /auth/me — call this whenever something outside the
        // normal login/signup flow can change the user record (e.g. after
        // confirming an email link, or whenever a page like Profile wants
        // to make sure it isn't showing stale is_verified state).
        refreshUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);