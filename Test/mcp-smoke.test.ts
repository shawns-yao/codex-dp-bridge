import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpEntryPath } from "../src/paths.js";

test("MCP 服务可以启动并暴露冻结设计中的工具", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntryPath],
    env: { ...process.env }
  });
  const client = new Client({ name: "codex-dp-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "codex_dp_cancel",
      "codex_dp_continue_dispute",
      "codex_dp_finish",
      "codex_dp_implement",
      "codex_dp_revise",
      "codex_dp_start_review",
      "codex_dp_status"
    ]);
  } finally {
    await client.close();
  }
});
