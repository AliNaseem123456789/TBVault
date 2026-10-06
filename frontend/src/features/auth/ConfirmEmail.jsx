import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { confirmEmail } from "../../api/auth.api";
import { useAuth } from "./AuthProvider";
import Button from "../../components/ui/Button";
import "./AuthLayout.css";

const ConfirmEmail = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Confirming...");
  const [done, setDone] = useState(false);
  const { refreshUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("Missing confirmation token");
      setDone(true);
      return;
    }
    confirmEmail(token)
      .then((res) => {
        setStatus(res.message || "Email confirmed");
        // If this browser is still logged in, pull the fresh is_verified
        // value now so Profile.jsx doesn't show stale "not verified" state
        // if they navigate there next.
        refreshUser?.();
      })
      .catch((err) => setStatus(err?.response?.data?.message || "Confirmation failed"))
      .finally(() => setDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="status-shell">
      {!done && <div className="spinner" />}
      <p>{status}</p>
      {done && <Button to="/login">Continue to login</Button>}
    </div>
  );
};

export default ConfirmEmail;
