import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { verifyEmail } from "../../api/auth.api";
import AuthLayout from "./AuthLayout";
import Button from "../../components/ui/Button";

const VerifyEmail = () => {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setError("");
    setMessage("");
    setSending(true);
    try {
      const res = await verifyEmail();
      setMessage(res.message || "Verification email sent");
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to send verification email");
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout title="Verify your email" subtitle={user?.email}>
      <Button onClick={handleSend} disabled={sending} className="auth-form__submit">
        {sending ? "Sending..." : "Send verification email"}
      </Button>
      {message && <p className="form-alert form-alert-success">{message}</p>}
      {error && <p className="form-alert form-alert-error">{error}</p>}
    </AuthLayout>
  );
};

export default VerifyEmail;
