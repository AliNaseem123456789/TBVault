import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCents, salePriceCents, bestSaleFor, couponProblem, couponDiscountCents, matchShippingZone, shippingCents, computeTotals,
} from "../src/utils/pricing.helpers.js";
import { csvCell, toCsv } from "../src/utils/csv.helpers.js";
import { parseCouponInput } from "../src/modules/coupons/coupon.validation.js";
import { parseSaleInput } from "../src/modules/sales/sale.validation.js";
import { parseAddressInput } from "../src/modules/addresses/address.validation.js";

const now = new Date("2026-10-07T12:00:00Z");
const hourAgo = new Date(now.getTime() - 3600e3);
const hourLater = new Date(now.getTime() + 3600e3);

test("money is handled in cents without float drift", () => {
  assert.equal(toCents("19.99"), 1999);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(salePriceCents(1999, 15), 1699);
  assert.equal(salePriceCents(1999, 0), 1999);
});

test("the biggest live sale wins, product or category", () => {
  const sales = [
    { id: 1, is_active: true, percent_off: 10, product_id: 5, starts_at: hourAgo, ends_at: hourLater },
    { id: 2, is_active: true, percent_off: 25, category_id: 2, starts_at: hourAgo, ends_at: hourLater },
    { id: 3, is_active: false, percent_off: 50, product_id: 5, starts_at: hourAgo, ends_at: hourLater },
    { id: 4, is_active: true, percent_off: 60, product_id: 5, starts_at: hourLater, ends_at: new Date(hourLater.getTime() + 1) },
  ];
  assert.equal(bestSaleFor(sales, { productId: 5, categoryId: 2, now }).percent, 25);
  assert.equal(bestSaleFor(sales, { productId: 5, categoryId: 9, now }).percent, 10);
  assert.equal(bestSaleFor(sales, { productId: 6, categoryId: 9, now }), null);
});

test("coupon rules: active window, usage limits, minimum spend", () => {
  const base = { is_active: true, type: "PERCENT", value: 10, times_used: 0 };
  assert.equal(couponProblem(base, { now, subtotalCents: 100 }), null);
  assert.match(couponProblem(null, { now, subtotalCents: 100 }), /isn't valid/);
  assert.match(couponProblem({ ...base, is_active: false }, { now, subtotalCents: 100 }), /isn't valid/);
  assert.match(couponProblem({ ...base, starts_at: hourLater }, { now, subtotalCents: 100 }), /isn't active yet/);
  assert.match(couponProblem({ ...base, expires_at: hourAgo }, { now, subtotalCents: 100 }), /expired/);
  assert.match(couponProblem({ ...base, usage_limit: 5, times_used: 5 }, { now, subtotalCents: 100 }), /fully redeemed/);
  assert.match(couponProblem({ ...base, per_user_limit: 1 }, { now, subtotalCents: 100, customerUses: 1 }), /already used/);
  assert.match(couponProblem({ ...base, min_order_amount: "50" }, { now, subtotalCents: 4999 }), /\$50\.00/);
});

test("coupon discounts are capped", () => {
  assert.equal(couponDiscountCents({ type: "PERCENT", value: 10 }, 5000), 500);
  assert.equal(couponDiscountCents({ type: "PERCENT", value: 50, max_discount: "10" }, 5000), 1000);
  assert.equal(couponDiscountCents({ type: "FIXED", value: "80" }, 5000), 5000);
  assert.equal(couponDiscountCents({ type: "FREE_SHIPPING", value: 0 }, 5000), 0);
});

test("shipping zone matching falls back to the default zone", () => {
  const zones = [
    { id: 1, regions: [], rate: 5, free_over: 50, is_default: true },
    { id: 2, regions: ["karachi", "sindh"], rate: 3 },
  ];
  assert.equal(matchShippingZone(zones, { city: " KARACHI " }).id, 2);
  assert.equal(matchShippingZone(zones, { city: "Hyderabad", state: "Sindh" }).id, 2);
  assert.equal(matchShippingZone(zones, { city: "Lahore" }).id, 1);
  assert.equal(matchShippingZone(zones, null).id, 1);
  assert.equal(matchShippingZone([], { city: "Lahore" }), null);
  assert.equal(shippingCents(zones[0], 5000), 0);
  assert.equal(shippingCents(zones[0], 4999), 500);
  assert.equal(shippingCents(zones[1], 100, { freeShipping: true }), 0);
});

test("totals: discount before shipping threshold and tax; shipping not taxed", () => {
  const totals = computeTotals({
    lines: [{ unitCents: 3000, quantity: 2 }],
    coupon: { type: "FIXED", value: 15 },
    zone: { rate: 5, free_over: 50 },
    taxRate: 10,
  });
  // 60 - 15 = 45 < 50 so shipping applies; tax 4.50
  assert.deepEqual(totals, { subtotal: 6000, discount: 1500, shipping: 500, tax: 450, total: 5450 });
});

test("csv cells are quoted and formula-prefixed", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("-12.50"), "-12.50");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv(["a", "b"], [[1, "x\ny"]]), 'a,b\r\n1,"x\ny"\r\n');
});

test("coupon input validation", () => {
  assert.match(parseCouponInput({ code: "a", type: "PERCENT", value: 10 }).error, /3-40/);
  assert.match(parseCouponInput({ code: "SAVE", type: "PERCENT", value: 150 }).error, /1 and 100/);
  assert.deepEqual(parseCouponInput({ code: "ship-free", type: "FREE_SHIPPING" }).data, { code: "SHIP-FREE", type: "FREE_SHIPPING", value: 0 });
  assert.match(parseCouponInput({ code: "SAVE", type: "FIXED", value: 5, starts_at: "2026-10-10", expires_at: "2026-10-01" }).error, /after/);
});

test("sale input needs exactly one target and a valid window", () => {
  const window = { starts_at: "2026-10-01", ends_at: "2026-10-08" };
  assert.match(parseSaleInput({ name: "x", percent_off: 10, ...window }).error, /product_id or category_id/);
  assert.match(parseSaleInput({ name: "x", percent_off: 95, product_id: 1, ...window }).error, /1 to 90/);
  assert.equal(parseSaleInput({ name: "x", percent_off: 10, category_id: 2, ...window }).error, undefined);
});

test("address input validation", () => {
  assert.match(parseAddressInput({}).error, /full name/);
  const ok = parseAddressInput({ full_name: " Ali ", phone: "+92 300 1234567", line1: "1 Main", city: "Karachi", country: "Pakistan" });
  assert.equal(ok.data.full_name, "Ali");
  assert.match(parseAddressInput({ full_name: "A", phone: "call me", line1: "x", city: "y", country: "z" }).error, /phone/);
});
