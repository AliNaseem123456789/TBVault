const layout = (body) => `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#888;font-size:12px">TBVault · if you didn't request this, ignore this email.</p>
  </div>`;

export const templates = {
  resetPassword: ({ resetUrl }) => ({
    subject: "Reset your password",
    html: layout(`
      <h2>Reset your password</h2>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 7 days and can only be used once.</p>`),
    text: `Reset your password: ${resetUrl}\nExpires in 7 days.`,
  }),

  verifyEmail: ({ verifyUrl }) => ({
    subject: "Verify your email",
    html: layout(`
      <h2>Verify your email</h2>
      <p><a href="${verifyUrl}">Click here to verify your email</a></p>
      <p>This link expires in 24 hours.</p>`),
    text: `Verify your email: ${verifyUrl}\nExpires in 24 hours.`,
  }),
};