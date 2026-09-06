import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useNavigate, Link } from "react-router-dom";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const auth = useAuth();

  const { login } = auth;
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const result = await login(email, password);
      navigate("/profile");
    } catch (err) {
      console.log("login threw an error:", err);
      setError(err?.response?.data?.message || "Login failed");
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "http://localhost:3000/api/auth/google";
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "280px",
          padding: "24px",
          border: "1px solid #ddd",
          borderRadius: "8px",
        }}
      >
        <h2 style={{ textAlign: "center", margin: "0 0 10px" }}>Login</h2>

        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "8px" }}
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: "8px" }}
        />

        <div style={{ textAlign: "right", fontSize: "13px" }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>

        <button type="submit" style={{ padding: "8px" }}>
          Login
        </button>

        <button
          type="button"
          onClick={handleGoogleLogin}
          style={{ padding: "8px" }}
        >
          Login with Google
        </button>

        {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}

        <p style={{ textAlign: "center", margin: 0, fontSize: "14px" }}>
          Don't have an account? <Link to="/sign-up">Sign up</Link>
        </p>
      </form>
    </div>
  );
};

export default Login;