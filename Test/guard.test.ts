import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import guard from "../src/pi-guard-extension.js";

test("Pi 工具守卫阻止越界读取和未授权写入", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-guard-"));
  const policyPath = path.join(root, "policy.json");
  let handler: ((event: unknown) => Promise<unknown>) | undefined;
  const fakePi = { on: (_event: string, value: (event: unknown) => Promise<unknown>) => { handler = value; } };
  guard(fakePi as never);
  assert.ok(handler);
  process.env.CODEX_DP_POLICY_PATH = policyPath;
  try {
    await fs.writeFile(policyPath, JSON.stringify({ root, mode: "review", allowedPaths: [], sensitivePatterns: [".env"], maxToolCalls: 10, generation: 0 }), "utf8");
    const outside = await handler!({ toolName: "read", input: { path: path.resolve(root, "..", "outside.txt") } });
    assert.deepEqual(outside, { block: true, reason: "禁止访问当前任务根目录之外的路径", terminate: true });
    const writeDuringReview = await handler!({ toolName: "write", input: { path: path.join(root, "src", "a.ts") } });
    assert.deepEqual(writeDuringReview, { block: true, reason: "当前模式禁止直接写入", terminate: true });
    await fs.writeFile(policyPath, JSON.stringify({ root, mode: "direct", allowedPaths: ["src"], sensitivePatterns: [".env"], maxToolCalls: 10, generation: 1 }), "utf8");
    assert.equal(await handler!({ toolName: "write", input: { path: path.join(root, "src", "a.ts") } }), undefined);
    const sensitive = await handler!({ toolName: "read", input: { path: path.join(root, ".env") } });
    assert.deepEqual(sensitive, { block: true, reason: "禁止访问敏感文件", terminate: true });
  } finally {
    delete process.env.CODEX_DP_POLICY_PATH;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("权限策略短暂损坏只拒绝本次调用，不终止会话", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-policy-"));
  const policyPath = path.join(root, "policy.json");
  let handler: ((event: unknown) => Promise<unknown>) | undefined;
  guard({ on: (_event: string, value: (event: unknown) => Promise<unknown>) => { handler = value; } } as never);
  process.env.CODEX_DP_POLICY_PATH = policyPath;
  try {
    await fs.writeFile(policyPath, "{", "utf8");
    const result = await handler!({ toolName: "read", input: { path: path.join(root, "a.txt") } });
    assert.deepEqual(result, { block: true, reason: "codex-dp 权限策略暂时不可读，已拒绝本次调用", terminate: false });
  } finally {
    delete process.env.CODEX_DP_POLICY_PATH;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("直接模式拒绝通过目录链接写到根目录之外", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-link-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-link-out-"));
  const policyPath = path.join(root, "policy.json");
  const link = path.join(root, "src", "linked");
  let handler: ((event: unknown) => Promise<unknown>) | undefined;
  try {
    await fs.mkdir(path.dirname(link), { recursive: true });
    try { await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { context.skip(`当前环境不能创建目录链接：${String(error)}`); return; }
    await fs.writeFile(policyPath, JSON.stringify({ root, mode: "direct", allowedPaths: ["src"], sensitivePatterns: [], maxToolCalls: 10, generation: 0 }), "utf8");
    guard({ on: (_event: string, value: (event: unknown) => Promise<unknown>) => { handler = value; } } as never);
    process.env.CODEX_DP_POLICY_PATH = policyPath;
    const result = await handler!({ toolName: "write", input: { path: path.join(link, "escape.txt") } });
    assert.equal((result as { block?: boolean }).block, true);
  } finally {
    delete process.env.CODEX_DP_POLICY_PATH;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
