import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useNavigate, Link } from "react-router-dom";

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
        <h2 style={{ textAlign: "center", margin: "0 0 10px" }}>Sign Up</h2>

        <input
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "8px" }}
        />
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
        <input
          type="password"
          placeholder="confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={{ padding: "8px" }}
        />

        <button type="submit" style={{ padding: "8px" }}>
          Sign up
        </button>

        <button
          type="button"
          onClick={handleGoogleLogin}
          style={{ padding: "8px" }}
        >
          Sign up with Google
        </button>

        {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}

        <p style={{ textAlign: "center", margin: 0, fontSize: "14px" }}>
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </form>
    </div>
  );
};

export default Signup;