// Values like product names and addresses come from users, so escape them before putting them in HTML.
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const layout = (body, footer = "If you didn't request this, you can ignore this email.") => `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#888;font-size:12px">TBVault · ${footer}</p>
  </div>`;

const itemsTable = (items = []) => `
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${items
      .map(
        (i) => `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #eee">${esc(i.quantity)} × ${esc(i.name)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">$${esc(i.totalPrice)}</td>
        </tr>`
      )
      .join("")}
  </table>`;

const itemsText = (items = []) => items.map((i) => `- ${i.quantity} x ${i.name}: $${i.totalPrice}`).join("\n");

const STATUS_COPY = {
  confirmed: { subject: "confirmed", line: "We've confirmed your order and are getting it ready." },
  shipped: { subject: "on its way", line: "Your order has shipped and is on its way to you." },
  delivered: { subject: "delivered", line: "Your order has been delivered. We hope you love it." },
  cancelled: { subject: "cancelled", line: "Your order has been cancelled. If you didn't expect this, reply to this email." },
};

export const templates = {
  resetPassword: ({ resetUrl }) => ({
    subject: "Reset your password",
    html: layout(`
      <h2>Reset your password</h2>
      <p><a href="${esc(resetUrl)}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour and can only be used once.</p>`),
    text: `Reset your password: ${resetUrl}\nExpires in 1 hour.`,
  }),

  verifyEmail: ({ verifyUrl }) => ({
    subject: "Verify your email",
    html: layout(`
      <h2>Verify your email</h2>
      <p><a href="${esc(verifyUrl)}">Click here to verify your email</a></p>
      <p>This link expires in 24 hours.</p>`),
    text: `Verify your email: ${verifyUrl}\nExpires in 24 hours.`,
  }),

  orderPlaced: ({ orderId, name, items, totalAmount, shippingAddress, orderUrl }) => ({
    subject: `Order #${orderId} received`,
    html: layout(
      `
      <h2>Thanks for your order${name ? `, ${esc(name)}` : ""}!</h2>
      <p>We've received order <strong>#${esc(orderId)}</strong>. Payment is due on delivery.</p>
      ${itemsTable(items)}
      <p style="text-align:right;font-weight:bold">Total: $${esc(totalAmount)}</p>
      ${shippingAddress ? `<p style="white-space:pre-line;color:#555">Shipping to:<br>${esc(shippingAddress)}</p>` : ""}
      <p><a href="${esc(orderUrl)}">View your order</a></p>`,
      "You're receiving this because you placed an order."
    ),
    text: `Thanks for your order #${orderId}.\n\n${itemsText(items)}\n\nTotal: $${totalAmount}\n\nView it: ${orderUrl}`,
  }),

  orderStatus: ({ orderId, status, orderUrl }) => {
    const copy = STATUS_COPY[status] ?? { subject: `updated (${status})`, line: `Your order status is now: ${status}.` };
    return {
      subject: `Order #${orderId} ${copy.subject}`,
      html: layout(
        `
        <h2>Order #${esc(orderId)} ${esc(copy.subject)}</h2>
        <p>${esc(copy.line)}</p>
        <p><a href="${esc(orderUrl)}">View your order</a></p>`,
        "You're receiving this because you placed an order."
      ),
      text: `Order #${orderId} ${copy.subject}. ${copy.line}\n\nView it: ${orderUrl}`,
    };
  },
};
