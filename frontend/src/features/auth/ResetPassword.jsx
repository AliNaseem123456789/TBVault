import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resetPassword } from "../../api/auth.api";

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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "10px", width: "280px", padding: "24px", border: "1px solid #ddd", borderRadius: "8px" }}
      >
        <h2 style={{ textAlign: "center", margin: "0 0 10px" }}>Reset Password</h2>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "8px" }}
        />
        <input
          type="password"
          placeholder="new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: "8px" }}
        />
        <button type="submit" style={{ padding: "8px" }}>Reset password</button>
        {message && <p style={{ color: "green", margin: 0 }}>{message}</p>}
        {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
};

export default ResetPassword;