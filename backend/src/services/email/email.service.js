import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendResetPasswordEmail = async (to, resetUrl) => {

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Reset your password",
      html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 7 days.</p>`,
    });

    if (info.rejected.length > 0) {
      console.warn("Some recipients were rejected:", info.rejected);
    }
    return info;
  } catch (err) {
    switch (err.code) {
      case "ECONNECTION":
      case "ETIMEDOUT":
        console.error("Network error - retry later:", err.message);
        break;
      case "EAUTH":
        console.error("Authentication failed:", err.message);
        break;
      case "EENVELOPE":
        console.error("Invalid envelope:", err.message, err.rejected || []);
        break;
      default:
        console.error("Send failed:", err.message);
    }
    throw err; // let the caller decide how to respond to the client
  }
};


export const sendVerifyEmail = async (to, resetUrl) => {

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Verify your Email",
      html: `<p>Click <a href="${resetUrl}">here</a> verify your email. This link expires in 7 days.</p>`,
    });

    if (info.rejected.length > 0) {
      console.warn("Some recipients were rejected:", info.rejected);
    }
    return info;
  } catch (err) {
    switch (err.code) {
      case "ECONNECTION":
      case "ETIMEDOUT":
        console.error("Network error - retry later:", err.message);
        break;
      case "EAUTH":
        console.error("Authentication failed:", err.message);
        break;
      case "EENVELOPE":
        console.error("Invalid envelope:", err.message, err.rejected || []);
        break;
      default:
        console.error("Send failed:", err.message);
    }
    throw err; // let the caller decide how to respond to the client
  }
};