import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductInput } from "../src/modules/products/product.validation.js";
import { parseReviewInput } from "../src/modules/reviews/review.validation.js";
import { canTransition, ORDER_STATUSES } from "../src/modules/orders/order.status.js";

// ---------- products ----------
test("product create requires name, price and category", () => {
  assert.match(parseProductInput({}).error, /name/);
  assert.match(parseProductInput({ name: "Lamp" }).error, /price/);
  assert.match(parseProductInput({ name: "Lamp", price: 10 }).error, /category_id/);
});

test("product create accepts numbers sent as strings and trims the name", () => {
  const { data, error } = parseProductInput({ name: "  Lamp ", price: "19.99", category_id: "2", stock: "5" });
  assert.equal(error, undefined);
  assert.deepEqual(data, { name: "Lamp", price: 19.99, category_id: 2, stock: 5 });
});

test("product rejects negative price, fractional stock and non-boolean is_hidden", () => {
  const base = { name: "Lamp", price: 1, category_id: 1 };
  assert.match(parseProductInput({ ...base, price: -1 }).error, /price/);
  assert.match(parseProductInput({ ...base, stock: 1.5 }).error, /stock/);
  assert.match(parseProductInput({ ...base, is_hidden: "true" }).error, /is_hidden/);
});

test("product update (partial) only validates the fields that were sent", () => {
  const { data, error } = parseProductInput({ is_hidden: true }, { partial: true });
  assert.equal(error, undefined);
  assert.deepEqual(data, { is_hidden: true });
});

// ---------- reviews ----------
test("review rating must be a whole number from 1 to 5", () => {
  for (const rating of [0, 6, 3.5, "abc", undefined]) {
    assert.ok(parseReviewInput({ rating }).error, `rating ${rating} should be rejected`);
  }
  assert.deepEqual(parseReviewInput({ rating: "4" }).data, { rating: 4 });
});

test("review comment is trimmed, blank becomes null, and over 2000 chars is rejected", () => {
  assert.equal(parseReviewInput({ rating: 5, comment: "  great  " }).data.comment, "great");
  assert.equal(parseReviewInput({ rating: 5, comment: "   " }).data.comment, null);
  assert.ok(parseReviewInput({ rating: 5, comment: "x".repeat(2001) }).error);
});

test("review edit (partial) can change just the comment", () => {
  assert.deepEqual(parseReviewInput({ comment: "edited" }, { partial: true }).data, { comment: "edited" });
});

// ---------- order status ----------
test("orders move forward one step at a time", () => {
  assert.ok(canTransition("pending", "confirmed"));
  assert.ok(canTransition("confirmed", "shipped"));
  assert.ok(canTransition("shipped", "delivered"));
});

test("orders can be cancelled only before they ship", () => {
  assert.ok(canTransition("pending", "cancelled"));
  assert.ok(canTransition("confirmed", "cancelled"));
  assert.ok(!canTransition("shipped", "cancelled"));
  assert.ok(!canTransition("delivered", "cancelled"));
});

test("finished orders can't change and steps can't be skipped", () => {
  for (const to of ORDER_STATUSES) {
    assert.ok(!canTransition("delivered", to));
    assert.ok(!canTransition("cancelled", to));
  }
  assert.ok(!canTransition("pending", "delivered"));
  assert.ok(!canTransition("unknown", "confirmed"));
});
