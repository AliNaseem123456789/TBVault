import { useAuth } from "./AuthProvider";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { verifyEmail } from "../../api/auth.api";

function Profile() {
    const { logout, user } = useAuth();
    const navigate = useNavigate();
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    async function handleLogOut() {
        await logout();
        navigate("/login");
    }

    async function handleVerifyEmail() {
        setMessage("");
        setError("");
        try {
            const res = await verifyEmail(user?.email);
            setMessage(res.message || "Verification email sent");
        } catch (err) {
            setError(err?.response?.data?.message || "Failed to send verification email");
        }
    }

    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "100vh",
            }}
        >
            <div
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
                <h2 style={{ textAlign: "center", margin: "0 0 10px" }}>Profile</h2>

                <p style={{ margin: 0 }}>{user?.email}</p>

                {!user?.is_verified && (
                    <div style={{ background: "#fff3cd", padding: "10px", borderRadius: "4px" }}>
                        <p style={{ margin: "0 0 8px" }}>Your email isn't verified.</p>
                        <button onClick={handleVerifyEmail} style={{ padding: "6px" }}>
                            Send verification email
                        </button>
                    </div>
                )}

                {message && <p style={{ color: "green", margin: 0 }}>{message}</p>}
                {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}

                <button onClick={handleLogOut} style={{ padding: "8px" }}>
                    Logout
                </button>
            </div>
        </div>
    );
}

export default Profile;