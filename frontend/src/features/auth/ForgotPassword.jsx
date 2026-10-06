import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../../api/auth.api";
import AuthLayout from "./AuthLayout";
import Button from "../../components/ui/Button";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await forgotPassword(email);
      setMessage(res.message || "If that email exists, a reset link was sent.");
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong");
    }
  };

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <>
          Remembered it? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            className="input"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {message && <p className="form-alert form-alert-success">{message}</p>}
        {error && <p className="form-alert form-alert-error">{error}</p>}

        <Button type="submit" className="auth-form__submit">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ForgotPassword;
