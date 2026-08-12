import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertAllowedPaths, assertBinaryAuthorization, assertSafeCommand, isWithin, redact, validatePatchPaths } from "../src/security.js";

test("工作区路径边界拒绝越界路径", () => {
  const root = path.resolve("C:/workspace/project");
  assert.equal(isWithin(root, path.join(root, "src", "index.ts")), true);
  assert.equal(isWithin(root, path.join(root, "..cache", "index.ts")), true);
  assert.equal(isWithin(root, path.resolve(root, "..", "secret.txt")), false);
  assert.throws(() => assertAllowedPaths(root, ["../secret.txt"]), /超出工作区/);
});

test("数据库命令被拒绝", () => {
  assert.throws(() => assertSafeCommand("sqlite3 local.db .tables"), /数据库/);
  assert.throws(() => assertSafeCommand("prisma migrate deploy"), /数据库/);
  assert.doesNotThrow(() => assertSafeCommand("npm run build"));
});

test("补丁只能包含批准范围", () => {
  const patch = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b";
  assert.doesNotThrow(() => validatePatchPaths(patch, ["src"]));
  assert.doesNotThrow(() => validatePatchPaths(patch, ["."]));
  assert.throws(() => validatePatchPaths(patch, ["docs"]), /批准范围外/);
});

test("补丁路径拒绝绝对路径和目录穿越", () => {
  const traversal = "--- a/src/a.ts\n+++ b/src/../secret.ts\n@@ -1 +1 @@\n-a\n+b";
  const absolute = "--- a/src/a.ts\n+++ C:/secret.ts\n@@ -1 +1 @@\n-a\n+b";
  assert.throws(() => validatePatchPaths(traversal, ["src"]), /目录穿越/);
  assert.throws(() => validatePatchPaths(absolute, ["."]), /无效路径/);
});

test("敏感信息脱敏", () => {
  assert.equal(redact("api_key=abcdef token: xyz"), "api_key=<redacted> token: <redacted>");
  assert.equal(redact("Authorization: Bearer abc.def"), "Authorization: <redacted>");
});

test("每个实施和修订补丁都必须经过二进制授权", () => {
  const binaryPatch = "diff --git a/a.png b/a.png\nGIT binary patch\nliteral 1\nA";
  assert.throws(() => assertBinaryAuthorization(binaryPatch, false), /单独取得用户授权/);
  assert.doesNotThrow(() => assertBinaryAuthorization(binaryPatch, true));
});
