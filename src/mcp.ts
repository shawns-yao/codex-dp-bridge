#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { discoverPi } from "./pi-discovery.js";
import { TaskManager } from "./task-manager.js";
import { THINKING_LEVELS } from "./types.js";

const manager = new TaskManager();
const server = new McpServer({ name: "codex-dp", version: "0.1.0" });
let shuttingDown = false;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await manager.shutdownAll(reason).catch(() => undefined);
  await server.close().catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => { void shutdown(signal).finally(() => process.exit(0)); });
}
process.stdin.once("end", () => { void shutdown("stdin_end"); });
process.stdin.once("close", () => { void shutdown("stdin_close"); });
process.once("uncaughtException", (error) => {
  void shutdown("uncaught_exception").finally(() => {
    console.error(error);
    process.exit(1);
  });
});
process.once("unhandledRejection", (error) => {
  void shutdown("unhandled_rejection").finally(() => {
    console.error(error);
    process.exit(1);
  });
});

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

server.registerTool("codex_dp_status", {
  description: "检查 codex-dp、Pi 版本和当前内存任务，不启动模型请求",
  inputSchema: {}
}, async () => {
  const config = await loadConfig();
  const pi = await discoverPi(config);
  return text({ pi, config: { ...config, sensitivePatterns: `[${config.sensitivePatterns.length} patterns]` }, tasks: manager.list() });
});

server.registerTool("codex_dp_start_review", {
  description: "在用户明确协作授权后，使用选定的 Pi 模型对 Codex 初步方案进行一轮独立反方审查",
  inputSchema: {
    projectRoot: z.string(),
    requirements: z.string().min(1),
    codexProposal: z.string().min(1),
    collaborationAuthorized: z.boolean(),
    requestedModel: z.string().optional(),
    requestedThinkingLevel: z.enum(THINKING_LEVELS).optional()
  }
}, async (input) => text(await manager.startReview(input)));

server.registerTool("codex_dp_continue_dispute", {
  description: "仅在存在明确技术分歧时执行第二轮审查；之后必须由 Codex 告知用户",
  inputSchema: { taskId: z.string(), codexResponse: z.string().min(1) }
}, async ({ taskId, codexResponse }) => text({ taskId, result: await manager.continueDispute(taskId, codexResponse) }));

server.registerTool("codex_dp_implement", {
  description: "在方案冻结并获得实施授权后，生成补丁或修改隔离工作区",
  inputSchema: {
    taskId: z.string(),
    frozenPlan: z.string().min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    implementationAuthorized: z.boolean(),
    mode: z.enum(["patch", "direct"]),
    includeUncommittedStateAuthorized: z.boolean().optional().default(false),
    binaryChangesAuthorized: z.boolean().optional().default(false)
  }
}, async (input) => text(await manager.implement(input)));

server.registerTool("codex_dp_revise", {
  description: "根据 Codex 审查或验证反馈修订，最多两轮且不能扩大范围",
  inputSchema: { taskId: z.string(), feedback: z.string().min(1) }
}, async ({ taskId, feedback }) => text(await manager.revise(taskId, feedback)));

server.registerTool("codex_dp_finish", {
  description: "结束任务；正常完成时可清理隔离工作区",
  inputSchema: { taskId: z.string(), cleanup: z.boolean().default(true) }
}, async ({ taskId, cleanup }) => {
  await manager.finish(taskId, cleanup);
  return text({ taskId, finished: true, cleanup });
});

server.registerTool("codex_dp_cancel", {
  description: "立即终止 Pi 会话，保留异常隔离结果",
  inputSchema: { taskId: z.string() }
}, async ({ taskId }) => {
  await manager.cancel(taskId);
  return text({ taskId, cancelled: true });
});

await server.connect(new StdioServerTransport());
