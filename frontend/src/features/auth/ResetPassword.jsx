import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { resetPassword } from "../../api/auth.api";
import AuthLayout from "./AuthLayout";
import Button from "../../components/ui/Button";

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!token) {
      setError("Missing or invalid reset link");
      return;
    }

    try {
      const res = await resetPassword(token, email, password);
      setMessage(res.message || "Password changed successfully");
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      setError(err?.response?.data?.message || "Reset failed");
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Choose a new password for your account."
      footer={
        <>
          Back to <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            className="input"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {message && <p className="form-alert form-alert-success">{message}</p>}
        {error && <p className="form-alert form-alert-error">{error}</p>}

        <Button type="submit" className="auth-form__submit">
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;
