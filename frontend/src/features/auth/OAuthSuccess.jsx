import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import "./AuthLayout.css";

const OAuthSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  console.log("OAuthSuccess: auth context =", auth);

  useEffect(() => {
    const token = searchParams.get("token");
    console.log("OAuthSuccess: token from URL =", token);
    if (token) {
      auth.setToken(token);
      console.log("OAuthSuccess: called setToken, navigating to /profile");
      navigate("/profile");
    } else {
      console.log("OAuthSuccess: no token, redirecting to login");
      navigate("/login?error=oauth_failed");
    }
  }, []);

  return (
    <div className="status-shell">
      <div className="spinner" />
      <p>Signing you in...</p>
    </div>
  );
};

export default OAuthSuccess;
