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

const RETURN_COPY = {
  REQUESTED: "We've received your return request and will review it shortly.",
  APPROVED: "Your return is approved. Please send the items back; reply to this email if you need the return address.",
  REJECTED: "We couldn't accept this return.",
  RECEIVED: "We've received the items you sent back.",
  REFUNDED: "Your return is complete and the refund has been issued.",
};

const money = (value) => `$${esc(value)}`;
const totalsTable = ({ subtotal, discountTotal, shippingTotal, taxTotal, totalAmount, couponCode, creditsApplied }) => {
  const row = (label, value, bold = false) =>
    `<tr><td style="padding:4px 0">${label}</td><td style="padding:4px 0;text-align:right${bold ? ";font-weight:bold" : ""}">${value}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
    ${subtotal ? row("Subtotal", money(subtotal)) : ""}
    ${Number(discountTotal) > 0 ? row(`Discount${couponCode ? ` (${esc(couponCode)})` : ""}`, `−${money(discountTotal)}`) : ""}
    ${shippingTotal !== undefined ? row("Shipping", Number(shippingTotal) > 0 ? money(shippingTotal) : "Free") : ""}
    ${Number(taxTotal) > 0 ? row("Tax", money(taxTotal)) : ""}
    ${row("Total", money(totalAmount), true)}
    ${Number(creditsApplied) > 0 ? row("Paid with store credit", `−${money(creditsApplied)}`) : ""}
  </table>`;
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

  orderPlaced: ({ orderId, name, items, subtotal, discountTotal, shippingTotal, taxTotal, totalAmount, couponCode, creditsApplied, paymentMethod, shippingAddress, orderUrl }) => {
    // Card and store-credit orders are paid by the time this is sent.
    const paidByCard = paymentMethod === "card" || paymentMethod === "credits";
    return {
      subject: `Order #${orderId} ${paidByCard ? "confirmed" : "received"}`,
      html: layout(
        `
        <h2>Thanks for your order${name ? `, ${esc(name)}` : ""}!</h2>
        <p>${paidByCard ? `We've received your payment for order <strong>#${esc(orderId)}</strong>.` : `We've received order <strong>#${esc(orderId)}</strong>. Payment is due on delivery.`}</p>
        ${itemsTable(items)}
        ${totalsTable({ subtotal, discountTotal, shippingTotal, taxTotal, totalAmount, couponCode, creditsApplied })}
        ${shippingAddress ? `<p style="white-space:pre-line;color:#555">Shipping to:<br>${esc(shippingAddress)}</p>` : ""}
        <p><a href="${esc(orderUrl)}">View or track your order</a></p>`,
        "You're receiving this because you placed an order."
      ),
      text: `Thanks for your order #${orderId}.\n\n${itemsText(items)}\n\nTotal: $${totalAmount}${paymentMethod === "credits" ? " (paid with store credit)" : paidByCard ? " (paid)" : " (pay on delivery)"}\n\nView it: ${orderUrl}`,
    };
  },

  orderStatus: ({ orderId, status, orderUrl, trackingCarrier, trackingNumber, trackingUrl }) => {
    const copy = STATUS_COPY[status] ?? { subject: `updated (${status})`, line: `Your order status is now: ${status}.` };
    const tracking = status === "shipped" && (trackingNumber || trackingUrl);
    const trackingHtml = tracking
      ? `<p>${trackingCarrier ? `${esc(trackingCarrier)} tracking` : "Tracking"}${trackingNumber ? `: <strong>${esc(trackingNumber)}</strong>` : ""}${trackingUrl ? ` · <a href="${esc(trackingUrl)}">Track the parcel</a>` : ""}</p>`
      : "";
    return {
      subject: `Order #${orderId} ${copy.subject}`,
      html: layout(
        `
        <h2>Order #${esc(orderId)} ${esc(copy.subject)}</h2>
        <p>${esc(copy.line)}</p>
        ${trackingHtml}
        <p><a href="${esc(orderUrl)}">View your order</a></p>`,
        "You're receiving this because you placed an order."
      ),
      text: `Order #${orderId} ${copy.subject}. ${copy.line}${tracking ? `\nTracking: ${[trackingCarrier, trackingNumber, trackingUrl].filter(Boolean).join(" ")}` : ""}\n\nView it: ${orderUrl}`,
    };
  },

  orderRefunded: ({ orderId, refundAmount, paymentMethod, refundToCredits, orderUrl }) => ({
    subject: `Refund for order #${orderId}`,
    html: layout(
      `
      <h2>We've refunded $${esc(refundAmount)}</h2>
      <p>${refundToCredits ? "It has been added to your store credit, ready to spend right away." : paymentMethod === "card" ? "The money is on its way back to your card. Banks usually show it within 5-10 business days." : "We'll return the money to you directly."}</p>
      <p><a href="${esc(orderUrl)}">View order #${esc(orderId)}</a></p>`,
      "You're receiving this because you placed an order."
    ),
    text: `We've refunded $${refundAmount} for order #${orderId}.\n\nView it: ${orderUrl}`,
  }),

  returnUpdate: ({ orderId, returnId, returnStatus, adminNote, refundAmount, orderUrl }) => {
    const copy = RETURN_COPY[returnStatus] ?? `Your return is now ${String(returnStatus).toLowerCase()}.`;
    return {
      subject: `Return #${returnId} for order #${orderId}: ${String(returnStatus).toLowerCase()}`,
      html: layout(
        `
        <h2>Return #${esc(returnId)} ${esc(String(returnStatus).toLowerCase())}</h2>
        <p>${esc(copy)}</p>
        ${refundAmount ? `<p>Refund: <strong>$${esc(refundAmount)}</strong></p>` : ""}
        ${adminNote ? `<p style="color:#555">Note from us: ${esc(adminNote)}</p>` : ""}
        <p><a href="${esc(orderUrl)}">View order #${esc(orderId)}</a></p>`,
        "You're receiving this because you requested a return."
      ),
      text: `Return #${returnId} for order #${orderId}: ${copy}${refundAmount ? ` Refund: $${refundAmount}.` : ""}${adminNote ? `\nNote: ${adminNote}` : ""}\n\nView it: ${orderUrl}`,
    };
  },

  lowStock: ({ items, threshold, adminUrl }) => ({
    subject: `Low stock: ${items.length === 1 ? items[0].name : `${items.length} products`}`,
    html: layout(
      `
      <h2>Running low</h2>
      <p>These are at or below your low-stock threshold of ${esc(threshold)}:</p>
      <ul>${items.map((i) => `<li>${esc(i.name)}: <strong>${esc(i.stock)}</strong> left</li>`).join("")}</ul>
      <p><a href="${esc(adminUrl)}">Open the admin dashboard</a></p>`,
      "You're receiving this as a TBVault store admin."
    ),
    text: `Low stock (threshold ${threshold}):\n${items.map((i) => `- ${i.name}: ${i.stock} left`).join("\n")}\n\n${adminUrl}`,
  }),

  backInStock: ({ productName, productUrl }) => ({
    subject: `${productName} is back in stock`,
    html: layout(
      `
      <h2>It's back!</h2>
      <p><strong>${esc(productName)}</strong> is back in stock. Quantities may be limited.</p>
      <p><a href="${esc(productUrl)}">Shop it now</a></p>`,
      "You asked us to email you when this was back in stock."
    ),
    text: `${productName} is back in stock: ${productUrl}`,
  }),
};
