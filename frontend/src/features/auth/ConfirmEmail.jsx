import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { confirmEmail } from "../../api/auth.api";

const ConfirmEmail = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Confirming...");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("Missing confirmation token");
      return;
    }
    confirmEmail(token)
      .then((res) => setStatus(res.message || "Email confirmed"))
      .catch((err) => setStatus(err?.response?.data?.message || "Confirmation failed"));
  }, []);

  return <p>{status}</p>;
};

export default ConfirmEmail;