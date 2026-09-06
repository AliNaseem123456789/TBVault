import { useState } from "react";
import { forgotPassword } from "../../api/auth.api";

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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "10px", width: "280px", padding: "24px", border: "1px solid #ddd", borderRadius: "8px" }}
      >
        <h2 style={{ textAlign: "center", margin: "0 0 10px" }}>Forgot Password</h2>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "8px" }}
        />
        <button type="submit" style={{ padding: "8px" }}>Send reset link</button>
        {message && <p style={{ color: "green", margin: 0 }}>{message}</p>}
        {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
};

export default ForgotPassword;