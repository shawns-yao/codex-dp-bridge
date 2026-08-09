import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteFile } from "../src/atomic-write.js";

test("原子写入不会留下临时文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-atomic-"));
  try {
    const target = path.join(root, "config.json");
    await atomicWriteFile(target, "{\"ok\":true}\n");
    assert.equal(await fs.readFile(target, "utf8"), "{\"ok\":true}\n");
    await atomicWriteFile(target, "{\"ok\":false}\n");
    assert.equal(await fs.readFile(target, "utf8"), "{\"ok\":false}\n");
    assert.deepEqual((await fs.readdir(root)).sort(), ["config.json"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
