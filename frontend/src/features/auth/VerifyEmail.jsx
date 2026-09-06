import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { verifyEmail } from "../../api/auth.api";

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
    <div>
      <p>{user?.email}</p>
      <button onClick={handleSend} disabled={sending}>
        {sending ? "Sending..." : "Send verification email"}
      </button>
      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
};

export default VerifyEmail;