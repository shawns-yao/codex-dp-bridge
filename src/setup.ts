import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findCommand, runCommand } from "./command-discovery.js";
import { atomicWriteFile } from "./atomic-write.js";
import { cliEntryPath, configBackupDirectory, mcpEntryPath } from "./paths.js";
import { isPathWithin, pathsEqual } from "./path-utils.js";

const mcpName = "codex-dp";

interface CodexConfigSnapshot {
  target: string;
  existed: boolean;
  backupPath?: string;
}

export function setupPreview(): object {
  return {
    platform: process.platform,
    mcp: { name: mcpName, command: process.execPath, args: [mcpEntryPath] },
    note: "codex-dp 命令由 npm 管理；apply 只注册 Codex MCP 服务"
  };
}

export async function setupApply(): Promise<void> {
  await fs.access(cliEntryPath);
  await fs.access(mcpEntryPath);
  const snapshot = await backupCodexConfig();
  try {
    const list = await runCodex(["mcp", "list"]);
    if (list.code !== 0) throw new Error(list.stderr || "无法读取 Codex MCP 配置");
    if (hasMcpEntry(list.stdout)) throw new Error("已存在同名 Codex MCP 服务");
    const add = await runCodex(["mcp", "add", mcpName, "--", process.execPath, mcpEntryPath]);
    if (add.code !== 0) throw new Error(add.stderr || "Codex MCP 注册失败");
  } catch (error) {
    await restoreCodexConfig(snapshot);
    throw error;
  }
}

export async function setupRemove(): Promise<void> {
  const snapshot = await backupCodexConfig();
  try {
    const remove = await runCodex(["mcp", "remove", mcpName]);
    if (remove.code !== 0 && !/not found|不存在/i.test(remove.stderr)) throw new Error(remove.stderr || "Codex MCP 移除失败");
  } catch (error) {
    await restoreCodexConfig(snapshot);
    throw error;
  }
}

async function runCodex(args: string[]) {
  const configured = process.env.CODEX_DP_CODEX_COMMAND?.trim();
  if (configured) {
    const commandPath = await findCommand(configured);
    return await runCommand(commandPath, args, undefined, 30000);
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    const powershellScript = path.join(process.env.APPDATA, "npm", "codex.ps1");
    if (await exists(powershellScript)) return await runCommand(powershellScript, args, undefined, 30000);
  }
  const commandPath = await findCommand("codex");
  return await runCommand(commandPath, args, undefined, 30000);
}

async function backupCodexConfig(): Promise<CodexConfigSnapshot> {
  const source = path.join(codexHomeDirectory(), "config.toml");
  if (!(await exists(source))) return { target: source, existed: false };
  await fs.mkdir(configBackupDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(configBackupDirectory, `codex-config.${new Date().toISOString().replace(/[:.]/g, "-")}.toml.bak`);
  await fs.copyFile(source, target);
  return { target: source, existed: true, backupPath: target };
}

async function restoreCodexConfig(snapshot: CodexConfigSnapshot): Promise<void> {
  const expectedRoot = codexHomeDirectory();
  const target = path.resolve(snapshot.target);
  if (!pathsEqual(path.dirname(target), expectedRoot) || !isPathWithin(expectedRoot, target)) {
    throw new Error("拒绝恢复预期目录之外的 Codex 配置");
  }
  if (snapshot.existed) {
    if (!snapshot.backupPath) throw new Error("Codex 配置备份缺失");
    await atomicWriteFile(target, await fs.readFile(snapshot.backupPath, "utf8"));
  } else {
    await fs.rm(target, { force: true });
  }
}

function codexHomeDirectory(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("CODEX_HOME 必须是绝对路径");
    return path.resolve(configured);
  }
  return path.join(os.homedir(), ".codex");
}

function hasMcpEntry(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.trim() === mcpName || new RegExp(`(?:^|\\s)${mcpName}(?:\\s|$)`).test(line));
}

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; }
  catch { return false; }
}
