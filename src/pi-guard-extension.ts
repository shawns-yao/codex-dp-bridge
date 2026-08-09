import path from "node:path";
import fs from "node:fs/promises";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

interface Policy {
  root: string;
  mode: "review" | "patch" | "direct";
  allowedPaths: string[];
  sensitivePatterns: string[];
  maxToolCalls: number;
  generation: number;
}

function normalize(value: string): string { return path.resolve(value).toLowerCase(); }

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`(^|[\\/])${escaped}($|[\\/])`, "i");
}

function targetPath(event: ToolCallEvent, root: string): string {
  const input = event.input as Record<string, unknown>;
  const candidate = typeof input.path === "string" ? input.path : root;
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

async function readPolicy(policyPath: string): Promise<Policy | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return JSON.parse(await fs.readFile(policyPath, "utf8")) as Policy; }
    catch { if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  return undefined;
}

async function canonicalTarget(root: string, target: string): Promise<{ root: string; target: string }> {
  const realRoot = await fs.realpath(root);
  let existing = target;
  const suffix: string[] = [];
  while (true) {
    try { await fs.lstat(existing); break; }
    catch {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("无法解析目标路径");
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const realExisting = await fs.realpath(existing);
  return { root: normalize(realRoot), target: normalize(path.join(realExisting, ...suffix)) };
}

async function containsSymlink(root: string, target: string): Promise<boolean> {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) return true; }
    catch { break; }
  }
  return false;
}

export default function guard(pi: ExtensionAPI): void {
  let generation = -1;
  let toolCalls = 0;
  pi.on("tool_call", async (event) => {
    const policyPath = process.env.CODEX_DP_POLICY_PATH;
    if (!policyPath) return { block: true, reason: "缺少 codex-dp 权限策略", terminate: true };
    const policy = await readPolicy(policyPath);
    if (!policy) return { block: true, reason: "codex-dp 权限策略暂时不可读，已拒绝本次调用", terminate: false };
    if (policy.generation !== generation) {
      generation = policy.generation;
      toolCalls = 0;
    }
    if (toolCalls >= policy.maxToolCalls) {
      return { block: true, reason: "当前阶段工具调用预算已用完，请停止调用工具并立即返回最终结果", terminate: false };
    }
    if (event.toolName === "bash") return { block: true, reason: "Pi 不允许执行 Shell", terminate: true };
    const target = targetPath(event, policy.root);
    const lexicalRoot = normalize(policy.root);
    const lexicalTarget = normalize(target);
    if (!(lexicalTarget === lexicalRoot || lexicalTarget.startsWith(`${lexicalRoot}${path.sep}`))) {
      return { block: true, reason: "禁止访问当前任务根目录之外的路径", terminate: true };
    }
    let canonical: { root: string; target: string };
    try { canonical = await canonicalTarget(policy.root, target); }
    catch { return { block: true, reason: "无法安全解析目标路径", terminate: false }; }
    if (!(canonical.target === canonical.root || canonical.target.startsWith(`${canonical.root}${path.sep}`))) {
      return { block: true, reason: "禁止通过符号链接访问任务根目录之外的路径", terminate: true };
    }
    const relative = path.relative(policy.root, target).replaceAll("\\", "/");
    if (policy.sensitivePatterns.some((pattern) => wildcard(pattern).test(relative))) {
      return { block: true, reason: "禁止访问敏感文件", terminate: true };
    }
    if (event.toolName === "edit" || event.toolName === "write") {
      if (policy.mode !== "direct") return { block: true, reason: "当前模式禁止直接写入", terminate: true };
      if (await containsSymlink(policy.root, target)) return { block: true, reason: "直接模式禁止通过符号链接写入", terminate: true };
      const allowed = policy.allowedPaths.some((entry) => {
        const allowedTarget = normalize(path.resolve(policy.root, entry));
        return lexicalTarget === allowedTarget || lexicalTarget.startsWith(`${allowedTarget}${path.sep}`);
      });
      if (!allowed) return { block: true, reason: "写入路径不在已批准范围内", terminate: true };
    }
    toolCalls += 1;
    return undefined;
  });
}
