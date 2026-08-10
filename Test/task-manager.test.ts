import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { RpcClient } from "@earendil-works/pi-coding-agent";
import { TaskManager } from "../src/task-manager.js";
import { tempDirectory } from "../src/paths.js";
import type { TaskPhase } from "../src/types.js";

interface FakeClientState {
  aborts: number;
  stops: number;
}

test("第二轮分歧失败时终止 Pi 并保留脱敏失败摘要", async () => {
  const taskId = uniqueTaskId("dispute");
  const manager = new TaskManager();
  const state = await seedTask(manager, taskId, "review");
  try {
    await assert.rejects(manager.continueDispute(taskId, "Codex 回应"), /模拟阶段失败/);
    await assertFailedAndRemoved(manager, taskId, state);
  } finally {
    await cleanup(taskId);
  }
});

test("实施失败时终止 Pi 并保留脱敏失败摘要", async () => {
  const taskId = uniqueTaskId("implement");
  const manager = new TaskManager();
  const state = await seedTask(manager, taskId, "review");
  try {
    await assert.rejects(manager.implement({
      taskId,
      frozenPlan: "冻结方案",
      allowedPaths: ["src"],
      implementationAuthorized: true,
      mode: "patch"
    }), /模拟阶段失败/);
    await assertFailedAndRemoved(manager, taskId, state);
  } finally {
    await cleanup(taskId);
  }
});

test("修订失败时终止 Pi 并保留脱敏失败摘要", async () => {
  const taskId = uniqueTaskId("revise");
  const manager = new TaskManager();
  const state = await seedTask(manager, taskId, "implementing");
  try {
    await assert.rejects(manager.revise(taskId, "修订反馈"), /模拟阶段失败/);
    await assertFailedAndRemoved(manager, taskId, state);
  } finally {
    await cleanup(taskId);
  }
});

test("MCP 异常关闭时为所有活动任务写入失败摘要", async () => {
  const taskId = uniqueTaskId("shutdown");
  const manager = new TaskManager();
  const state = await seedTask(manager, taskId, "review", false);
  try {
    await manager.shutdownAll("test_shutdown");
    const failure = await fs.readFile(path.join(tempDirectory, taskId, "failure.txt"), "utf8");
    assert.match(failure, /test_shutdown/);
    assert.equal(manager.list().length, 0);
    assert.equal(state.aborts, 1);
    assert.equal(state.stops, 1);
  } finally {
    await cleanup(taskId);
  }
});

async function seedTask(manager: TaskManager, taskId: string, phase: TaskPhase, failPrompt = true): Promise<FakeClientState> {
  const taskDirectory = path.join(tempDirectory, taskId);
  const policyPath = path.join(taskDirectory, "policy.json");
  await fs.mkdir(taskDirectory, { recursive: true });
  const state: FakeClientState = { aborts: 0, stops: 0 };
  const client = {
    prompt: async () => { if (failPrompt) throw new Error("模拟阶段失败 token=secret-token"); },
    waitForIdle: async () => undefined,
    getLastAssistantText: async () => "",
    abort: async () => { state.aborts += 1; },
    stop: async () => { state.stops += 1; }
  } as unknown as RpcClient;
  const task = {
    id: taskId,
    projectRoot: path.resolve("."),
    phase,
    createdAt: Date.now(),
    model: "deepseek-v4-flash",
    thinkingLevel: "max",
    revisionRounds: 0,
    allowedPaths: ["src"],
    binaryChangesAuthorized: false,
    activeExecutionMs: 0,
    client,
    policyPath,
    policy: {
      root: path.resolve("."),
      mode: phase === "implementing" ? "patch" : "review",
      allowedPaths: phase === "implementing" ? ["src"] : [],
      sensitivePatterns: ["secret-token"],
      maxToolCalls: 20,
      generation: 0
    }
  };
  const tasks = (manager as unknown as { tasks: Map<string, unknown> }).tasks;
  tasks.set(taskId, task);
  return state;
}

async function assertFailedAndRemoved(manager: TaskManager, taskId: string, state: FakeClientState): Promise<void> {
  const failure = await fs.readFile(path.join(tempDirectory, taskId, "failure.txt"), "utf8");
  assert.match(failure, /模拟阶段失败/);
  assert.doesNotMatch(failure, /secret-token/);
  assert.match(failure, /token=<redacted>/);
  assert.equal(manager.list().length, 0);
  assert.equal(state.aborts, 1);
  assert.equal(state.stops, 1);
}

function uniqueTaskId(prefix: string): string {
  return `test-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cleanup(taskId: string): Promise<void> {
  await fs.rm(path.join(tempDirectory, taskId), { recursive: true, force: true });
}
