import { test } from "node:test";
import assert from "node:assert/strict";
import multer from "multer";
import { handleUpload } from "../src/middleware/upload.middleware.js";

const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
// Stand-in for multer: calls back with whatever error we give it.
const failingWith = (err) => (req, res, cb) => cb(err);

test("an oversized file becomes a 400 with a readable message", () => {
  const res = mockRes();
  handleUpload(failingWith(new multer.MulterError("LIMIT_FILE_SIZE")))({}, res, () => assert.fail("next should not run"));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /5 MB/);
});

test("too many files becomes a 400", () => {
  const res = mockRes();
  handleUpload(failingWith(new multer.MulterError("LIMIT_FILE_COUNT")))({}, res, () => assert.fail("next should not run"));
  assert.equal(res.statusCode, 400);
});

test("a successful upload continues to the controller", () => {
  let called = false;
  handleUpload((req, res, cb) => cb())({}, mockRes(), () => { called = true; });
  assert.equal(called, true);
});

test("a non-multer error is passed on to Express's error handler", () => {
  const boom = new Error("disk full");
  let passed;
  handleUpload(failingWith(boom))({}, mockRes(), (err) => { passed = err; });
  assert.equal(passed, boom);
});
