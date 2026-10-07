import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import Button from "../../components/ui/Button";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [searchParams] = useSearchParams();
  // Google sign-in sends people back here with ?error=... when it fails.
  const OAUTH_ERRORS = {
    account_blocked: "This account has been blocked. Please contact support.",
    email_not_verified: "Your Google email isn't verified.",
  };
  const oauthError = searchParams.get("error");
  const [error, setError] = useState(oauthError ? OAUTH_ERRORS[oauthError] ?? "Google sign-in didn't work. Please try again." : "");
  const auth = useAuth();

  const { login } = auth;
  const navigate = useNavigate();
  // ProtectedRoute passes the page the user was trying to reach.
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate(location.state?.from || "/profile", { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Login failed");
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "http://localhost:3000/api/auth/google";
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to pick up your cart and orders."
      footer={
        <>
          Don't have an account? <Link to="/sign-up">Sign up</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            className="input"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <div className="field__row">
            <label htmlFor="login-password">Password</label>
            <Link to="/forgot-password" className="auth-form__link">
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="form-alert form-alert-error">{error}</p>}

        <Button type="submit" className="auth-form__submit">
          Log in
        </Button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <button type="button" className="btn btn-ghost auth-form__submit" onClick={handleGoogleLogin}>
        <span className="google-badge">G</span> Continue with Google
      </button>
    </AuthLayout>
  );
};

export default Login;
