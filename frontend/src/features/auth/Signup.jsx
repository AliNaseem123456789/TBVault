import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useNavigate, Link } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import Button from "../../components/ui/Button";

const Signup = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await signup(name, email, password, confirmPassword);
      navigate("/profile");
    } catch (err) {
      setError(err?.response?.data?.message || "Signup failed");
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "http://localhost:3000/api/auth/google";
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join TBVault for faster checkout and order tracking."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="signup-name">Name</label>
          <input
            id="signup-name"
            className="input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            className="input"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-confirm">Confirm password</label>
          <input
            id="signup-confirm"
            type="password"
            className="input"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="form-alert form-alert-error">{error}</p>}

        <Button type="submit" className="auth-form__submit">
          Sign up
        </Button>
      </form>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <button type="button" className="btn btn-ghost auth-form__submit" onClick={handleGoogleLogin}>
        <span className="google-badge">G</span> Sign up with Google
      </button>
    </AuthLayout>
  );
};

export default Signup;
