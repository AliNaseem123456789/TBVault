import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.ACCESS_TOKEN = "test-access-secret";
const { authenticate, authorize } = await import("../src/middleware/auth.middleware.js");

// Minimal Express stand-ins.
const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const run = (mw, req) => {
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

test("authenticate rejects a request with no Authorization header", () => {
  const { res, nextCalled } = run(authenticate, { headers: {} });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authenticate rejects a header that isn't a Bearer token", () => {
  const { res, nextCalled } = run(authenticate, { headers: { authorization: "Basic abc" } });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authenticate rejects a token signed with the wrong secret", () => {
  const token = jwt.sign({ sub: 1, role: "ADMIN" }, "someone-elses-secret");
  const { res, nextCalled } = run(authenticate, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authenticate rejects an expired token", () => {
  const token = jwt.sign({ sub: 1, role: "CUSTOMER", exp: Math.floor(Date.now() / 1000) - 10 }, process.env.ACCESS_TOKEN);
  const { res, nextCalled } = run(authenticate, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authenticate accepts a valid token and sets req.user", () => {
  const token = jwt.sign({ sub: 7, role: "CUSTOMER" }, process.env.ACCESS_TOKEN, { expiresIn: "15m" });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const { nextCalled } = run(authenticate, req);
  assert.equal(nextCalled, true);
  assert.equal(req.user.sub, 7);
  assert.equal(req.user.role, "CUSTOMER");
});

test("authorize returns 401 when there is no user", () => {
  const { res, nextCalled } = run(authorize("ADMIN"), {});
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authorize returns 403 for a customer on an admin route", () => {
  const { res, nextCalled } = run(authorize("ADMIN"), { user: { sub: 1, role: "CUSTOMER" } });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("authorize lets an admin through", () => {
  const { nextCalled } = run(authorize("ADMIN"), { user: { sub: 1, role: "ADMIN" } });
  assert.equal(nextCalled, true);
});
