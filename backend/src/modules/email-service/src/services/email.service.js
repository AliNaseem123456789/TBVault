import nodemailer from "nodemailer";
import { templates } from "./email.templates.js";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendEmail(templateName, to, vars = {}) {
  const build = templates[templateName];
  if (!build) throw new Error(`Unknown email template: ${templateName}`);

  const { subject, html, text } = build(vars);
console.log("[sendEmail]", templateName, to, JSON.stringify(vars));
console.log(html);
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
      text,
    });
    if (info.rejected?.length) console.warn("Rejected recipients:", info.rejected);
    return info;
  } catch (err) {
    switch (err.code) {
      case "ECONNECTION":
      case "ETIMEDOUT":
        console.error(`[${templateName}] network error, retryable:`, err.message);
        break;
      case "EAUTH":
        console.error(`[${templateName}] auth failed:`, err.message);
        break;
      case "EENVELOPE":
        console.error(`[${templateName}] bad envelope:`, err.message, err.rejected || []);
        break;
      default:
        console.error(`[${templateName}] send failed:`, err.message);
    }
    throw err;
  }
}

// thin named wrappers — nice call sites, no duplicated logic
export const sendResetPasswordEmail = (to, resetUrl) => sendEmail("resetPassword", to, { resetUrl });
export const sendVerifyEmail = (to, verifyUrl) => sendEmail("verifyEmail", to, { verifyUrl });