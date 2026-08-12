import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { setupPreview } from "../src/setup.js";

test("默认配置符合冻结设计", async () => {
  const config = await loadConfig();
  assert.equal(config.defaultMode, "patch");
  assert.equal(config.maxRevisionRounds, 2);
  assert.equal(config.provider, "opencode-go");
  assert.equal(typeof config.piCommand, "string");
  assert.equal(config.defaultThinkingLevel, "max");
  assert.equal(config.detailedLogging, false);
});

test("安装预览不会修改系统", () => {
  const preview = setupPreview() as { mcp: { name: string; command: string; args: string[] }; note: string };
  assert.equal(preview.mcp.name, "codex-dp");
  assert.equal(preview.mcp.command, process.execPath);
  assert.match(preview.mcp.args[0] ?? "", /dist[\\/]src[\\/]mcp\.js$/);
  assert.match(preview.note, /npm/);
});
