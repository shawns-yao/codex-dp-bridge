import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findCommand, runCommand } from "./command-discovery.js";
import { installUnixLauncher, isLauncherDirectoryOnPath, pathInstruction, removeUnixLauncher, restoreUnixLauncher, snapshotUnixLauncher, type UnixLauncherSnapshot } from "./launcher.js";
import { atomicWriteFile } from "./atomic-write.js";
import { cliEntryPath, configBackupDirectory, launcherDirectory, launcherPath, mcpEntryPath, projectRoot } from "./paths.js";
import { isPathWithin, pathsEqual } from "./path-utils.js";
import { run } from "./process.js";

const mcpName = "codex-dp";

interface CodexConfigSnapshot {
  target: string;
  existed: boolean;
  backupPath?: string;
}

export function setupPreview(): object {
  const pathEntry = process.platform === "win32" ? projectRoot : launcherDirectory;
  return {
    platform: process.platform,
    pathEntry,
    commandEntry: launcherPath,
    pathConfigured: process.platform === "win32" ? undefined : isLauncherDirectoryOnPath(),
    pathInstruction: pathInstruction(),
    mcp: { name: mcpName, command: process.execPath, args: [mcpEntryPath] },
    note: process.platform === "win32"
      ? "apply 会维护 Windows 用户级 PATH；执行前应确认不存在同名命令和同名 MCP 服务"
      : "apply 会安装用户级启动入口，但不会修改 shell 配置文件；请按 pathInstruction 配置 PATH"
  };
}

export async function setupApply(): Promise<void> {
  await fs.access(cliEntryPath);
  await fs.access(mcpEntryPath);
  const existing = await findCommand("codex-dp").catch(() => undefined);
  if (existing && !(await commandBelongsToProject(existing))) throw new Error(`发现同名 codex-dp 命令：${existing}`);

  const oldUserPath = process.platform === "win32" ? await readUserPath() : undefined;
  const snapshot = await backupCodexConfig();
  let launcherSnapshot: UnixLauncherSnapshot | undefined;
  const pathEntry = process.platform === "win32" ? projectRoot : launcherDirectory;
  const needsPath = oldUserPath !== undefined && !splitPath(oldUserPath).some((entry) => pathsEqual(entry, pathEntry));
  const needsUnixLauncher = process.platform !== "win32" && (!existing || pathsEqual(existing, launcherPath));
  try {
    if (process.platform === "win32") {
      if (needsPath) await writeUserPath([...splitPath(oldUserPath!), projectRoot].join(path.delimiter));
    } else if (needsUnixLauncher) {
      launcherSnapshot = await installUnixLauncher();
    }
    const list = await runCodex(["mcp", "list"]);
    if (list.code !== 0) throw new Error(list.stderr || "无法读取 Codex MCP 配置");
    if (hasMcpEntry(list.stdout)) throw new Error("已存在同名 Codex MCP 服务");
    const add = await runCodex(["mcp", "add", mcpName, "--", process.execPath, mcpEntryPath]);
    if (add.code !== 0) throw new Error(add.stderr || "Codex MCP 注册失败");
  } catch (error) {
    if (needsPath) await writeUserPath(oldUserPath!);
    await restoreUnixLauncher(launcherSnapshot).catch(() => undefined);
    await restoreCodexConfig(snapshot);
    throw error;
  }
}

export async function setupRemove(): Promise<void> {
  const oldUserPath = process.platform === "win32" ? await readUserPath() : undefined;
  const snapshot = await backupCodexConfig();
  const launcherSnapshot = process.platform === "win32" ? undefined : await snapshotUnixLauncher();
  try {
    if (process.platform === "win32") {
      const next = splitPath(oldUserPath!).filter((entry) => !pathsEqual(entry, projectRoot)).join(path.delimiter);
      await writeUserPath(next);
    } else {
      await removeUnixLauncher();
    }
    const remove = await runCodex(["mcp", "remove", mcpName]);
    if (remove.code !== 0 && !/not found|不存在/i.test(remove.stderr)) throw new Error(remove.stderr || "Codex MCP 移除失败");
  } catch (error) {
    if (process.platform === "win32") await writeUserPath(oldUserPath!);
    else await restoreUnixLauncher(launcherSnapshot).catch(() => undefined);
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

async function readUserPath(): Promise<string> {
  const script = "$v=[Environment]::GetEnvironmentVariable('Path','User');[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$v))";
  const result = await run("powershell.exe", ["-NoProfile", "-Command", script]);
  if (result.code !== 0) throw new Error(result.stderr);
  return Buffer.from(result.stdout, "base64").toString("utf16le");
}

async function writeUserPath(value: string): Promise<void> {
  const encoded = Buffer.from(value, "utf16le").toString("base64");
  const script = `$v=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));[Environment]::SetEnvironmentVariable('Path',$v,'User')`;
  const result = await run("powershell.exe", ["-NoProfile", "-Command", script]);
  if (result.code !== 0) throw new Error(result.stderr);
}

function splitPath(value: string): string[] {
  return value.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

async function commandBelongsToProject(commandPath: string): Promise<boolean> {
  if (pathsEqual(commandPath, launcherPath) || isPathWithin(projectRoot, commandPath)) return true;
  const resolvedCommandPath = await fs.realpath(commandPath).catch(() => commandPath);
  if (pathsEqual(resolvedCommandPath, cliEntryPath) || isPathWithin(projectRoot, resolvedCommandPath)) return true;
  const npmShimTarget = path.resolve(path.dirname(commandPath), "node_modules", "codex-dp", "dist", "src", "cli.js");
  return pathsEqual(npmShimTarget, cliEntryPath);
}

function hasMcpEntry(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.trim() === mcpName || new RegExp(`(?:^|\\s)${mcpName}(?:\\s|$)`).test(line));
}

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; }
  catch { return false; }
}
