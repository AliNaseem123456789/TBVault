import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { login as loginApi, register as registerApi, logout as logoutApi, me as meApi } from "../../api/auth.api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(localStorage.getItem("accessToken"));
  const [user, setUser] = useState(null);
  // True until we know who the user is. ProtectedRoute waits on it before
  // checking roles, otherwise an admin refreshing /admin gets bounced.
  const [userLoading, setUserLoading] = useState(Boolean(localStorage.getItem("accessToken")));

  const clearSession = useCallback(() => {
    localStorage.removeItem("accessToken");
    setAccessToken(null);
    setUser(null);
    setUserLoading(false);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const res = await meApi();
      setUser(res.data);
      return res.data;
    } catch (err) {
      console.error("Failed to fetch user:", err);
      // 401 here means even the refresh failed: the session is over.
      if (err?.response?.status === 401) clearSession();
      else setUser(null);
      return null;
    } finally {
      setUserLoading(false);
    }
  }, [clearSession]);

  // On app load, if a token already exists, fetch the user.
  useEffect(() => {
    if (accessToken) fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apiClient fires these when it silently refreshes the token or gives up.
  useEffect(() => {
    const onToken = (e) => setAccessToken(e.detail);
    const onLogout = () => clearSession();
    window.addEventListener("auth:token", onToken);
    window.addEventListener("auth:logout", onLogout);
    return () => {
      window.removeEventListener("auth:token", onToken);
      window.removeEventListener("auth:logout", onLogout);
    };
  }, [clearSession]);

  const setToken = async (token) => {
    localStorage.setItem("accessToken", token);
    setAccessToken(token);
    setUserLoading(true);
    await fetchUser();
  };

  const login = async (email, password) => {
    const res = await loginApi(email, password);
    await setToken(res.data.accessToken);
    return res;
  };

  const signup = async (name, email, password, confirmPassword) => {
    const res = await registerApi(name, email, password, confirmPassword);
    await setToken(res.data.accessToken);
    return res;
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch (err) {
      console.error(err);
    }
    clearSession();
  };

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        user,
        userLoading,
        isAuthenticated: !!accessToken,
        isAdmin: user?.role === "ADMIN",
        login,
        signup,
        logout,
        setToken,
        // Re-fetches /auth/me, e.g. after confirming an email link or editing the profile.
        refreshUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
