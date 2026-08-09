import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../src/process.js";
import { assertCleanGitWorkspace, cleanupTaskArtifacts, collectApprovedDelta, collectWorktreePatch, createIsolation, removeIsolation } from "../src/workspace.js";
import { tempDirectory } from "../src/paths.js";

test("直接模式拒绝存在未提交修改的工作区", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-git-"));
  try {
    await run("git", ["init"], root);
    await run("git", ["config", "user.email", "test@example.invalid"], root);
    await run("git", ["config", "user.name", "codex-dp test"], root);
    await fs.writeFile(path.join(root, "a.txt"), "a\n", "utf8");
    await run("git", ["add", "a.txt"], root);
    await run("git", ["commit", "-m", "test: 初始化"], root);
    await assert.doesNotReject(assertCleanGitWorkspace(root));
    await fs.writeFile(path.join(root, "a.txt"), "b\n", "utf8");
    await assert.rejects(assertCleanGitWorkspace(root), /未提交修改/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("隔离目录差异可以导出为补丁", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-diff-"));
  try {
    await run("git", ["init"], root);
    await run("git", ["config", "user.email", "test@example.invalid"], root);
    await run("git", ["config", "user.name", "codex-dp test"], root);
    await fs.writeFile(path.join(root, "a.txt"), "a\n", "utf8");
    await run("git", ["add", "a.txt"], root);
    await run("git", ["commit", "-m", "test: 初始化"], root);
    await fs.writeFile(path.join(root, "a.txt"), "b\n", "utf8");
    await fs.writeFile(path.join(root, "new.txt"), "new\n", "utf8");
    const patch = await collectWorktreePatch(root);
    assert.match(patch, /a\.txt/);
    assert.match(patch, /new\.txt/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("明确授权后可以复制未提交状态，并只导出 Pi 后续修改", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-dirty-"));
  const taskId = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let worktree: string | undefined;
  try {
    await run("git", ["init"], root);
    await run("git", ["config", "user.email", "test@example.invalid"], root);
    await run("git", ["config", "user.name", "codex-dp test"], root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
    await run("git", ["add", "src/a.txt"], root);
    await run("git", ["commit", "-m", "test: 初始化"], root);
    await fs.writeFile(path.join(root, "src", "a.txt"), "b\n", "utf8");
    await fs.writeFile(path.join(root, "src", "local.txt"), "local\n", "utf8");
    const isolation = await createIsolation(root, taskId, ["src"], true);
    worktree = isolation.worktree;
    assert.ok(isolation.baselinePath);
    assert.equal((await fs.readFile(path.join(worktree, "src", "a.txt"), "utf8")).replaceAll("\r\n", "\n"), "b\n");
    assert.equal((await fs.readFile(path.join(worktree, "src", "local.txt"), "utf8")).replaceAll("\r\n", "\n"), "local\n");
    await fs.writeFile(path.join(worktree, "src", "a.txt"), "c\n", "utf8");
    const patch = await collectApprovedDelta(isolation.baselinePath!, worktree, ["src"]);
    assert.match(patch, /-b/);
    assert.match(patch, /\+c/);
    assert.doesNotMatch(patch, /local\.txt/);
  } finally {
    if (worktree) await removeIsolation(root, worktree).catch(() => undefined);
    await fs.rm(path.join(tempDirectory, taskId), { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("隔离工作区初始化失败时回滚目录和 Git 元数据", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-rollback-"));
  const taskId = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const originalCp = fs.cp;
  try {
    await run("git", ["init"], root);
    await run("git", ["config", "user.email", "test@example.invalid"], root);
    await run("git", ["config", "user.name", "codex-dp test"], root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "a.txt"), "a\n", "utf8");
    await run("git", ["add", "src/a.txt"], root);
    await run("git", ["commit", "-m", "test: 初始化"], root);
    await fs.writeFile(path.join(root, "src", "a.txt"), "b\n", "utf8");
    fs.cp = async () => { throw new Error("模拟快照失败"); };

    await assert.rejects(createIsolation(root, taskId, ["src"], true), /模拟快照失败/);
    const listing = await run("git", ["worktree", "list", "--porcelain"], root);
    assert.doesNotMatch(listing.stdout, new RegExp(taskId));
    await assert.rejects(fs.access(path.join(tempDirectory, taskId, "worktree")), /ENOENT/);
  } finally {
    fs.cp = originalCp;
    await fs.rm(path.join(tempDirectory, taskId), { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("显式清理任务时同时移除 Git worktree 元数据", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-clean-"));
  const taskId = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await run("git", ["init"], root);
    await run("git", ["config", "user.email", "test@example.invalid"], root);
    await run("git", ["config", "user.name", "codex-dp test"], root);
    await fs.writeFile(path.join(root, "a.txt"), "a\n", "utf8");
    await run("git", ["add", "a.txt"], root);
    await run("git", ["commit", "-m", "test: 初始化"], root);
    await createIsolation(root, taskId, ["a.txt"], false);

    await cleanupTaskArtifacts(taskId);

    const listing = await run("git", ["worktree", "list", "--porcelain"], root);
    assert.doesNotMatch(listing.stdout, new RegExp(taskId));
    await assert.rejects(fs.access(path.join(tempDirectory, taskId)), /ENOENT/);
  } finally {
    await cleanupTaskArtifacts(taskId).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
});
