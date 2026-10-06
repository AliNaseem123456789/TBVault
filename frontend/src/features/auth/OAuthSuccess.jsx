import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import "./AuthLayout.css";

// Google sign-in lands here with ?token=<accessToken>. Store it, load the user,
// then leave the page with `replace` so the token isn't kept in browser history.
const OAuthSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      navigate("/login?error=oauth_failed", { replace: true });
      return;
    }
    setToken(token).then(() => navigate("/profile", { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="status-shell">
      <div className="spinner" />
      <p>Signing you in...</p>
    </div>
  );
};

export default OAuthSuccess;
