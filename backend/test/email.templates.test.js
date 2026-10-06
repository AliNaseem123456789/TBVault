import { test } from "node:test";
import assert from "node:assert/strict";
import { templates } from "../src/modules/email-service/src/services/email.templates.js";

test("order email escapes user-supplied text in the HTML", () => {
  const { html } = templates.orderPlaced({
    orderId: 12,
    name: "<script>alert(1)</script>",
    items: [{ name: "<b>Lamp</b>", quantity: 1, totalPrice: "10.00" }],
    totalAmount: "10.00",
    shippingAddress: "1 Main St <img src=x onerror=alert(1)>",
    orderUrl: "http://localhost:5173/orders/12",
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("reset and verify emails contain their link", () => {
  assert.ok(templates.resetPassword({ resetUrl: "http://x/reset?token=abc" }).html.includes("http://x/reset?token=abc"));
  assert.ok(templates.verifyEmail({ verifyUrl: "http://x/confirm?token=abc" }).html.includes("http://x/confirm?token=abc"));
});

test("every order status has its own subject line", () => {
  for (const status of ["confirmed", "shipped", "delivered", "cancelled"]) {
    const { subject } = templates.orderStatus({ orderId: 3, status, orderUrl: "u" });
    assert.match(subject, /^Order #3 /);
    assert.ok(!subject.includes("updated"), `${status} should have specific copy`);
  }
});
