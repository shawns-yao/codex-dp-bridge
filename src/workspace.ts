import fs from "node:fs/promises";
import path from "node:path";
import { run, runWithInput } from "./process.js";
import { tempDirectory } from "./paths.js";

async function git(root: string, args: string[]): Promise<string> {
  const result = await run("git", ["-C", root, ...args], undefined, 120000);
  if (result.code !== 0) throw new Error(result.stderr || `Git 命令失败：${args.join(" ")}`);
  return result.stdout;
}

export async function assertGitWorkspaceRoot(root: string): Promise<void> {
  const top = path.resolve(await git(root, ["rev-parse", "--show-toplevel"]));
  if (top.toLowerCase() !== path.resolve(root).toLowerCase()) throw new Error("直接模式要求目标目录是 Git 仓库根目录");
}

export async function assertCleanGitWorkspace(root: string): Promise<void> {
  await assertGitWorkspaceRoot(root);
  if (await git(root, ["status", "--porcelain"])) throw new Error("当前工作区存在未提交修改，禁止启动直接修改模式");
}

export async function createIsolation(
  root: string,
  taskId: string,
  allowedPaths: string[],
  includeUncommittedStateAuthorized: boolean
): Promise<{ worktree: string; baselinePath?: string; ignoredFileCount: number }> {
  await assertGitWorkspaceRoot(root);
  const ignored = await git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]);
  const ignoredFileCount = ignored.split(/\r?\n/).filter(Boolean).length;
  const dirty = Boolean(await git(root, ["status", "--porcelain"]));
  if (dirty && !includeUncommittedStateAuthorized) throw new Error("当前工作区存在未提交修改，禁止启动直接修改模式");
  const worktree = path.join(tempDirectory, taskId, "worktree");
  await fs.mkdir(path.dirname(worktree), { recursive: true });
  await git(root, ["worktree", "add", "--detach", worktree, "HEAD"]);
  try {
    if (!dirty) return { worktree, ignoredFileCount };
    const currentPatch = await collectWorktreePatch(root);
    const apply = await runWithInput("git", ["-C", worktree, "apply", "--binary", "--whitespace=nowarn", "-"], currentPatch, undefined, 120000);
    if (apply.code !== 0) throw new Error(`无法把用户未提交状态复制到隔离工作区：${apply.stderr}`);
    const baselinePath = path.join(tempDirectory, taskId, "baseline");
    await snapshotAllowedPaths(worktree, baselinePath, allowedPaths);
    return { worktree, baselinePath, ignoredFileCount };
  } catch (error) {
    await rollbackIncompleteIsolation(root, taskId, worktree);
    throw error;
  }
}

export async function collectWorktreePatch(worktree: string): Promise<string> {
  const tracked = await git(worktree, ["-c", "diff.renames=false", "diff", "HEAD", "--binary", "--no-ext-diff"]);
  const untracked = await git(worktree, ["ls-files", "--others", "--exclude-standard"]);
  const additions: string[] = [];
  for (const relative of untracked.split(/\r?\n/).filter(Boolean)) {
    const result = await run("git", ["-C", worktree, "diff", "--no-index", "--binary", "--", "/dev/null", relative], undefined, 120000);
    if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr);
    additions.push(result.stdout);
  }
  const sections = [tracked, ...additions].filter(Boolean).map((section) => section.trimEnd());
  return sections.length > 0 ? `${sections.join("\n")}\n` : "";
}

export async function collectApprovedDelta(baselinePath: string, worktree: string, allowedPaths: string[]): Promise<string> {
  const afterPath = path.join(path.dirname(baselinePath), "after");
  await fs.rm(afterPath, { recursive: true, force: true });
  await snapshotAllowedPaths(worktree, afterPath, allowedPaths);
  const result = await run("git", ["-c", "diff.renames=false", "diff", "--no-index", "--binary", "--", "baseline", "after"], path.dirname(baselinePath), 120000);
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr);
  const patch = normalizeSnapshotPatch(result.stdout);
  return patch ? `${patch.trimEnd()}\n` : "";
}

async function snapshotAllowedPaths(sourceRoot: string, targetRoot: string, allowedPaths: string[]): Promise<void> {
  await fs.mkdir(targetRoot, { recursive: true });
  for (const relative of allowedPaths) {
    const source = path.resolve(sourceRoot, relative);
    const target = path.resolve(targetRoot, relative);
    try { await fs.access(source); } catch { continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, force: true });
  }
}

function normalizeSnapshotPatch(patch: string): string {
  return patch
    .replaceAll("a/baseline/", "a/")
    .replaceAll("b/after/", "b/")
    .replaceAll("--- baseline/", "--- a/")
    .replaceAll("+++ after/", "+++ b/");
}

export async function removeIsolation(root: string, worktree: string): Promise<void> {
  const safeRoot = path.resolve(tempDirectory);
  const target = path.resolve(worktree);
  if (!target.startsWith(`${safeRoot}${path.sep}`)) throw new Error("拒绝清理 Temp 目录之外的隔离工作区");
  await git(root, ["worktree", "remove", "--force", target]);
}

export async function cleanupTaskArtifacts(taskId: string): Promise<void> {
  const target = resolveTaskDirectory(taskId);
  const worktree = path.join(target, "worktree");
  try {
    await fs.access(worktree);
    const root = await primaryWorktreeRoot(worktree);
    await removeIsolation(root, worktree);
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  await fs.rm(target, { recursive: true, force: true });
}

function resolveTaskDirectory(taskId: string): string {
  const root = path.resolve(tempDirectory);
  const target = path.resolve(tempDirectory, taskId);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("拒绝清理 Temp 目录之外的任务目录");
  return target;
}

async function primaryWorktreeRoot(worktree: string): Promise<string> {
  const listing = await git(worktree, ["worktree", "list", "--porcelain"]);
  const first = listing.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  if (!first) throw new Error("无法识别隔离工作区所属的 Git 仓库");
  return path.resolve(first.slice("worktree ".length));
}

async function rollbackIncompleteIsolation(root: string, taskId: string, worktree: string): Promise<void> {
  try {
    await removeIsolation(root, worktree);
  } catch {
    await fs.rm(worktree, { recursive: true, force: true }).catch(() => undefined);
    await git(root, ["worktree", "prune", "--expire", "now"]).catch(() => undefined);
  }
  const target = resolveTaskDirectory(taskId);
  await Promise.all([
    fs.rm(path.join(target, "worktree"), { recursive: true, force: true }),
    fs.rm(path.join(target, "baseline"), { recursive: true, force: true }),
    fs.rm(path.join(target, "after"), { recursive: true, force: true })
  ]);
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
