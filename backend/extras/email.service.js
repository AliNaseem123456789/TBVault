import nodemailer from "nodemailer";
import client from "prom-client";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});


// ================================
// EMAIL METRICS
// ================================

const emailSendDuration = new client.Histogram({
  name: "auth_email_send_duration_seconds",
  help: "Time spent sending authentication emails",
  labelNames: ["type", "status"],
  buckets: [
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
    10,
  ],
});

const emailsSentTotal = new client.Counter({
  name: "auth_emails_sent_total",
  help: "Total authentication emails processed",
  labelNames: ["type", "status"],
});


// ================================
// SEND RESET PASSWORD EMAIL
// ================================

export const sendResetPasswordEmail = async (to, resetToken) => {

  const start = process.hrtime.bigint();

  const type = "reset_password";

  try {

    const resetUrl =
      `${process.env.APP_URL}/reset-password?token=${resetToken}`;

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Reset your password",
      html: `
        <p>
          Click
          <a href="${resetUrl}">
            here
          </a>
          to reset your password.
          This link expires in 7 days.
        </p>
      `,
    });


    // ----------------------------
    // Measure successful send
    // ----------------------------

    const duration =
      Number(process.hrtime.bigint() - start) / 1e9;

    emailSendDuration.observe(
      {
        type,
        status: "success",
      },
      duration
    );

    emailsSentTotal.inc({
      type,
      status: "success",
    });


    if (info.rejected.length > 0) {

      console.warn(
        "Some recipients were rejected:",
        info.rejected
      );

    }

    return info;

  } catch (err) {

    // ----------------------------
    // Measure failed send
    // ----------------------------

    const duration =
      Number(process.hrtime.bigint() - start) / 1e9;

    emailSendDuration.observe(
      {
        type,
        status: "failure",
      },
      duration
    );

    emailsSentTotal.inc({
      type,
      status: "failure",
    });


    switch (err.code) {

      case "ECONNECTION":
      case "ETIMEDOUT":
        console.error(
          "Network error - retry later:",
          err.message
        );
        break;

      case "EAUTH":
        console.error(
          "Authentication failed:",
          err.message
        );
        break;

      case "EENVELOPE":
        console.error(
          "Invalid envelope:",
          err.message,
          err.rejected || []
        );
        break;

      default:
        console.error(
          "Send failed:",
          err.message
        );
    }

    throw err;
  }
};