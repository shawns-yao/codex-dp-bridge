import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { discoverPi } from "./pi-discovery.js";
import { guardExtensionPath, tempDirectory } from "./paths.js";
import { assertAllowedPaths, assertBinaryAuthorization, assertCurrentWorkspace, validatePatchPaths } from "./security.js";
import { collectApprovedDelta, collectWorktreePatch, createIsolation, removeIsolation } from "./workspace.js";
import { directPrompt, disputePrompt, patchPrompt, reviewPrompt, revisionPrompt } from "./prompts.js";
import { logEvent } from "./logger.js";
import { redact } from "./security.js";
import { atomicWriteFile } from "./atomic-write.js";
import { snapshotProcessTree, terminateProcessTree } from "./process.js";
import { applyThinkingLevel } from "./thinking.js";
import type { AppConfig, ImplementationInput, ReviewInput, TaskRecord, ThinkingLevel } from "./types.js";
import { isPathWithin, pathsEqual } from "./path-utils.js";

interface Policy {
  root: string;
  mode: "review" | "patch" | "direct";
  allowedPaths: string[];
  sensitivePatterns: string[];
  maxToolCalls: number;
  generation: number;
}

interface ActiveTask extends TaskRecord {
  client: RpcClient;
  policyPath: string;
  policy: Policy;
  piPid?: number | undefined;
}

export class TaskManager {
  private readonly tasks = new Map<string, ActiveTask>();

  private remaining(task: ActiveTask, requested: number, config: AppConfig): number {
    const totalRemaining = config.totalTimeoutMs - task.activeExecutionMs;
    if (totalRemaining <= 0) throw new Error("任务已达到总超时限制");
    return Math.min(requested, totalRemaining);
  }

  private async writePolicy(task: ActiveTask): Promise<void> {
    await atomicWriteFile(task.policyPath, `${JSON.stringify(task.policy, null, 2)}\n`);
  }

  private async withFailureHandling<T>(task: ActiveTask, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.failTask(task, error);
      throw error;
    }
  }

  private async promptAndWait(task: ActiveTask, prompt: string, timeoutMs: number, config: AppConfig): Promise<void> {
    const startedAt = Date.now();
    try {
      await task.client.prompt(prompt);
      await task.client.waitForIdle(this.remaining(task, timeoutMs, config));
    } finally {
      task.activeExecutionMs += Date.now() - startedAt;
    }
  }

  private async runAgent(task: ActiveTask, prompt: string, timeoutMs: number, config: AppConfig): Promise<string> {
    await this.promptAndWait(task, prompt, timeoutMs, config);
    let result = await task.client.getLastAssistantText();
    if (!result?.trim()) {
      await logEvent("empty_response_retry", { taskId: task.id, phase: task.phase });
      task.policy = { ...task.policy, maxToolCalls: 0, generation: task.policy.generation + 1 };
      await this.writePolicy(task);
      await this.promptAndWait(task, "上一轮没有返回最终文本。不要继续调用工具，请立即按照上一条消息要求的格式返回完整最终结果。", Math.min(timeoutMs, 120000), config);
      result = await task.client.getLastAssistantText();
    }
    if (!result?.trim()) throw new Error("DeepSeek 重试后仍未返回有效内容");
    task.lastResult = result;
    return result;
  }

  private async ensureMarker(task: ActiveTask, result: string, marker: string, timeoutMs: number, config: AppConfig): Promise<string> {
    if (extract(result, marker)) return result;
    await logEvent("format_retry", { taskId: task.id, phase: task.phase, marker });
    task.policy = { ...task.policy, maxToolCalls: 0, generation: task.policy.generation + 1 };
    await this.writePolicy(task);
    const retried = await this.runAgent(
      task,
      `上一轮缺少 ${marker} 标记。禁止继续调用工具，只根据已有上下文返回完整的 ${marker} 标记结果。`,
      Math.min(timeoutMs, 120000),
      config
    );
    if (!extract(retried, marker)) throw new Error(`DeepSeek 重试后仍缺少 ${marker} 标记`);
    return retried;
  }

  async startReview(input: ReviewInput): Promise<{ taskId: string; model: string; thinkingLevel: ThinkingLevel; result: string }> {
    if (!input.collaborationAuthorized) throw new Error("缺少当前任务的 codex-dp 协作授权");
    const config = await loadConfig();
    const root = assertCurrentWorkspace(input.projectRoot);
    const model = input.requestedModel || config.defaultModel;
    const thinkingLevel = input.requestedThinkingLevel || config.defaultThinkingLevel;
    if (!model) throw new Error("尚未配置默认 DeepSeek 模型，且当前任务未指定模型");
    const pi = await discoverPi(config);
    await fs.access(guardExtensionPath);
    const id = randomUUID();
    const taskDirectory = path.join(tempDirectory, id);
    const policyPath = path.join(taskDirectory, "policy.json");
    await fs.mkdir(taskDirectory, { recursive: true });
    const policy: Policy = {
      root,
      mode: "review",
      allowedPaths: [],
      sensitivePatterns: config.sensitivePatterns,
      maxToolCalls: 20,
      generation: 0
    };
    await atomicWriteFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const client = new RpcClient({
      cliPath: pi.cliPath,
      cwd: root,
      provider: config.provider,
      model,
      args: ["--no-session", "--tools", "read,grep,find,ls,edit,write", "--extension", guardExtensionPath],
      env: { CODEX_DP_POLICY_PATH: policyPath }
    });
    try {
      await client.start();
      await applyThinkingLevel(client, thinkingLevel);
    } catch (error) {
      await stopRpcClient(client, getRpcPid(client));
      await atomicWriteFile(path.join(taskDirectory, "failure.txt"), redact(String(error)));
      throw error;
    }
    const task: ActiveTask = {
      id,
      projectRoot: root,
      phase: "review",
      createdAt: Date.now(),
      model,
      thinkingLevel,
      revisionRounds: 0,
      allowedPaths: [],
      binaryChangesAuthorized: false,
      activeExecutionMs: 0,
      client,
      policyPath,
      policy,
      piPid: getRpcPid(client)
    };
    this.tasks.set(id, task);
    await logEvent("task_started", { taskId: id, phase: task.phase, model, thinkingLevel, provider: config.provider });
    try {
      const initial = await this.runAgent(task, reviewPrompt(input.requirements, input.codexProposal), config.analysisTimeoutMs, config);
      const result = await this.ensureMarker(task, initial, "CODEX_DP_REVIEW", config.analysisTimeoutMs, config);
      await logEvent("review_completed", { taskId: id, durationMs: Date.now() - task.createdAt });
      return { taskId: id, model, thinkingLevel, result };
    } catch (error) {
      await this.failTask(task, error);
      throw error;
    }
  }

  async continueDispute(taskId: string, codexResponse: string): Promise<string> {
    const config = await loadConfig();
    const task = this.requireTask(taskId);
    return await this.withFailureHandling(task, async () => {
      if (task.phase !== "review") throw new Error("只有第一轮审查任务可以进入技术分歧第二轮");
      task.phase = "dispute";
      task.policy = { ...task.policy, maxToolCalls: 8, generation: task.policy.generation + 1 };
      await this.writePolicy(task);
      const initial = await this.runAgent(task, disputePrompt(codexResponse), config.analysisTimeoutMs, config);
      const result = await this.ensureMarker(task, initial, "CODEX_DP_REVIEW", config.analysisTimeoutMs, config);
      await logEvent("dispute_completed", { taskId, activeExecutionMs: task.activeExecutionMs });
      return result;
    });
  }

  async implement(input: ImplementationInput): Promise<{ result: string; patch?: string; isolationPath?: string; ignoredFileCount?: number; warning?: string }> {
    if (!input.implementationAuthorized) throw new Error("缺少冻结方案后的实施授权");
    const config = await loadConfig();
    const task = this.requireTask(input.taskId);
    return await this.withFailureHandling(task, async () => {
      if (task.phase !== "review" && task.phase !== "dispute") throw new Error(`当前阶段不能开始实施：${task.phase}`);
      task.allowedPaths = assertAllowedPaths(task.projectRoot, input.allowedPaths);
      task.binaryChangesAuthorized = Boolean(input.binaryChangesAuthorized);
      task.phase = "implementing";
      if (input.mode === "patch") {
        task.policy = { ...task.policy, mode: "patch", allowedPaths: task.allowedPaths, maxToolCalls: 64, generation: task.policy.generation + 1 };
        await this.writePolicy(task);
        const initial = await this.runAgent(task, patchPrompt(input.frozenPlan, task.allowedPaths), config.implementationTimeoutMs, config);
        const result = await this.ensureMarker(task, initial, "CODEX_DP_PATCH", config.implementationTimeoutMs, config);
        const patch = extract(result, "CODEX_DP_PATCH");
        if (!patch) throw new Error("DeepSeek 未返回可识别的补丁标记");
        assertBinaryAuthorization(patch, task.binaryChangesAuthorized);
        validatePatchPaths(patch, task.allowedPaths);
        await logEvent("implementation_completed", { taskId: task.id, mode: "patch", patchBytes: Buffer.byteLength(patch) });
        return { result, patch };
      }
      const isolation = await createIsolation(task.projectRoot, task.id, task.allowedPaths, Boolean(input.includeUncommittedStateAuthorized));
      const isolationPath = isolation.worktree;
      task.isolationPath = isolationPath;
      task.baselinePath = isolation.baselinePath;
      task.ignoredFileCount = isolation.ignoredFileCount;
      task.policy = { ...task.policy, root: isolationPath, mode: "direct", allowedPaths: task.allowedPaths, maxToolCalls: 120, generation: task.policy.generation + 1 };
      await this.writePolicy(task);
      const result = await this.runAgent(task, directPrompt(input.frozenPlan, task.allowedPaths, isolationPath), config.implementationTimeoutMs, config);
      const patch = task.baselinePath ? await collectApprovedDelta(task.baselinePath, isolationPath, task.allowedPaths) : await collectWorktreePatch(isolationPath);
      assertBinaryAuthorization(patch, task.binaryChangesAuthorized);
      validatePatchPaths(patch, task.allowedPaths);
      await logEvent("implementation_completed", { taskId: task.id, mode: "direct", patchBytes: Buffer.byteLength(patch) });
      return { result, patch, isolationPath, ignoredFileCount: task.ignoredFileCount, ...(task.ignoredFileCount ? { warning: `检测到 ${task.ignoredFileCount} 个被 Git 忽略的文件或目录，未复制到隔离工作区` } : {}) };
    });
  }

  async revise(taskId: string, feedback: string): Promise<{ result: string; patch?: string }> {
    const config = await loadConfig();
    const task = this.requireTask(taskId);
    return await this.withFailureHandling(task, async () => {
      if (task.phase !== "implementing" && task.phase !== "revising") throw new Error(`当前阶段不能修订：${task.phase}`);
      if (task.revisionRounds >= config.maxRevisionRounds) throw new Error("已达到自动修订上限，必须停止并向用户报告");
      task.revisionRounds += 1;
      task.phase = "revising";
      const mode = task.isolationPath ? "direct" : "patch";
      task.policy = { ...task.policy, maxToolCalls: 64, generation: task.policy.generation + 1 };
      await this.writePolicy(task);
      const result = await this.runAgent(task, revisionPrompt(feedback, mode), config.revisionTimeoutMs, config);
      const patch = task.isolationPath ? task.baselinePath ? await collectApprovedDelta(task.baselinePath, task.isolationPath, task.allowedPaths) : await collectWorktreePatch(task.isolationPath) : extract(result, "CODEX_DP_PATCH");
      if (!patch) throw new Error("修订结果没有可识别的补丁");
      assertBinaryAuthorization(patch, task.binaryChangesAuthorized);
      validatePatchPaths(patch, task.allowedPaths);
      await logEvent("revision_completed", { taskId, round: task.revisionRounds, patchBytes: Buffer.byteLength(patch) });
      return { result, patch };
    });
  }

  async finish(taskId: string, cleanup: boolean): Promise<void> {
    const task = this.requireTask(taskId);
    await stopRpcClient(task.client, task.piPid);
    if (cleanup && task.isolationPath) await removeIsolation(task.projectRoot, task.isolationPath);
    if (cleanup) await cleanupTaskDirectory(task.id);
    task.phase = "completed";
    await logEvent("task_finished", { taskId, cleanup });
    this.tasks.delete(taskId);
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    await this.recordFailure(task, "用户取消了当前任务", "task_cancelled");
  }

  async shutdownAll(reason: string): Promise<void> {
    const active = [...this.tasks.values()];
    await Promise.all(active.map(async (task) => {
      await this.recordFailure(task, `MCP 服务异常关闭：${reason}`, "task_shutdown", { reason });
    }));
  }

  list(): Array<Omit<TaskRecord, "lastResult">> {
    return [...this.tasks.values()].map(({ client: _client, policy: _policy, policyPath: _policyPath, lastResult: _result, ...task }) => task);
  }

  private requireTask(taskId: string): ActiveTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在或已结束：${taskId}`);
    return task;
  }

  private async failTask(task: ActiveTask, error: unknown): Promise<void> {
    await this.recordFailure(task, error, "task_failed");
  }

  private async recordFailure(task: ActiveTask, error: unknown, event: string, metadata: Record<string, unknown> = {}): Promise<void> {
    task.phase = "failed";
    const summary = redact(error instanceof Error ? error.message : String(error));
    await stopRpcClient(task.client, task.piPid, true).catch(() => undefined);
    const taskDirectory = path.dirname(task.policyPath);
    await fs.mkdir(taskDirectory, { recursive: true }).catch(() => undefined);
    await atomicWriteFile(path.join(taskDirectory, "failure.txt"), `${summary}\n`).catch(() => undefined);
    await logEvent(event, { taskId: task.id, error: summary, retained: true, ...metadata }).catch(() => undefined);
    this.tasks.delete(task.id);
  }
}

async function cleanupTaskDirectory(taskId: string): Promise<void> {
  const root = path.resolve(tempDirectory);
  const target = path.resolve(tempDirectory, taskId);
  if (pathsEqual(root, target) || !isPathWithin(root, target)) throw new Error("拒绝清理 Temp 目录之外的任务目录");
  await fs.rm(target, { recursive: true, force: true });
}

function extract(text: string, marker: string): string | undefined {
  const match = text.match(new RegExp(`<<<${marker}>>>\\s*([\\s\\S]*?)\\s*<<<END_${marker}>>>`));
  return match?.[1]?.trim();
}

function getRpcPid(client: RpcClient): number | undefined {
  return (client as unknown as { process?: { pid?: number } }).process?.pid;
}

async function stopRpcClient(client: RpcClient, pid?: number, abort = false): Promise<void> {
  const descendants = await snapshotProcessTree(pid).catch(() => []);
  if (abort) await client.abort().catch(() => undefined);
  const treeStop = terminateProcessTree(pid, 250, descendants).catch(() => undefined);
  const clientStop = client.stop().catch(() => undefined);
  await Promise.all([treeStop, clientStop]);
}
