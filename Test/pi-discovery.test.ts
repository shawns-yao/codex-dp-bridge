import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverPi, resolvePiCliCandidate } from "../src/pi-discovery.js";
import type { AppConfig } from "../src/types.js";

test("默认使用 npm 包内的 Pi 运行时", async () => {
  const installation = await discoverPi(config({ piCommand: "" }));
  assert.equal(installation.source, "bundled");
  assert.equal(installation.version, "0.84.1");
  assert.match(installation.cliPath.replaceAll("\\", "/"), /node_modules\/@earendil-works\/pi-coding-agent\/dist\/cli\.js$/);
});

test("显式 Pi 路径可以指向项目根目录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-pi-project-"));
  const cliPath = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  try {
    await fs.mkdir(path.dirname(cliPath), { recursive: true });
    await fs.writeFile(cliPath, "export {};\n", "utf8");
    assert.equal(await resolvePiCliCandidate(root), cliPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("显式 Pi 路径可以指向 CLI 文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-pi-cli-"));
  const cliPath = path.join(root, "cli.js");
  try {
    await fs.writeFile(cliPath, "export {};\n", "utf8");
    assert.equal(await resolvePiCliCandidate(cliPath), cliPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    piCommand: "",
    compatiblePiRange: ">=0.84.1 <0.85.0",
    provider: "",
    defaultModel: "",
    defaultThinkingLevel: "max",
    defaultMode: "patch",
    analysisTimeoutMs: 600000,
    implementationTimeoutMs: 1800000,
    revisionTimeoutMs: 900000,
    totalTimeoutMs: 3600000,
    maxRevisionRounds: 2,
    detailedLogging: false,
    sensitivePatterns: [],
    ...overrides
  };
}
