import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isPathWithin, pathKey, pathsEqual } from "../src/path-utils.js";

test("路径比较只在 Windows 忽略大小写", () => {
  const upper = path.resolve("CaseSensitiveRoot");
  const lower = path.resolve("casesensitiveroot");
  assert.equal(pathsEqual(upper, lower), process.platform === "win32");
  assert.equal(pathKey(upper) === pathKey(lower), process.platform === "win32");
});

test("路径边界允许点号开头的内部目录并拒绝父目录", () => {
  const root = path.resolve("workspace");
  assert.equal(isPathWithin(root, path.join(root, "..cache", "a.txt")), true);
  assert.equal(isPathWithin(root, path.resolve(root, "..", "a.txt")), false);
});
