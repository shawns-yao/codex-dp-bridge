import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { setupPreview } from "../src/setup.js";

test("默认配置符合冻结设计", async () => {
  const config = await loadConfig();
  assert.equal(config.defaultMode, "patch");
  assert.equal(config.maxRevisionRounds, 2);
  assert.equal(config.provider, "opencode-go");
  assert.equal(config.detailedLogging, false);
});

test("安装预览不会修改系统", () => {
  const preview = setupPreview() as { pathEntry: string; mcp: { name: string } };
  assert.match(preview.pathEntry, /codex-dp$/i);
  assert.equal(preview.mcp.name, "codex-dp");
});
