import fs from "node:fs/promises";
import path from "node:path";
import { cliEntryPath, mcpEntryPath, projectRoot } from "./paths.js";
import { run } from "./process.js";

const mcpName = "codex-dp";

interface CodexConfigSnapshot {
  target: string;
  existed: boolean;
  backupPath?: string;
}

export function setupPreview(): object {
  return {
    pathEntry: projectRoot,
    commandEntry: cliEntryPath,
    mcp: { name: mcpName, command: process.execPath, args: [mcpEntryPath] },
    note: "apply 前应确认不存在同名命令和同名 MCP 服务"
  };
}

export async function setupApply(): Promise<void> {
  await fs.access(cliEntryPath);
  await fs.access(mcpEntryPath);
  if (process.platform !== "win32") throw new Error("当前安装配置只实现 Windows 用户级 PATH");
  const located = await run("where.exe", ["codex-dp"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (located.code === 0 && !located.stdout.toLowerCase().includes(projectRoot.toLowerCase())) {
    throw new Error(`发现同名 codex-dp 命令：${located.stdout}`);
  }
  const oldUserPath = await readUserPath();
  const snapshot = await backupCodexConfig();
  const entries = oldUserPath.split(";").filter(Boolean);
  const needsPath = !entries.some((entry) => path.resolve(entry).toLowerCase() === projectRoot.toLowerCase());
  try {
    if (needsPath) await writeUserPath([...entries, projectRoot].join(";"));
    const list = await runCodex(["mcp", "list"]);
    if (list.code !== 0) throw new Error(list.stderr || "无法读取 Codex MCP 配置");
    if (new RegExp(`(^|\\s)${mcpName}(\\s|$)`, "m").test(list.stdout)) throw new Error("已存在同名 Codex MCP 服务");
    const add = await runCodex(["mcp", "add", mcpName, "--", process.execPath, mcpEntryPath]);
    if (add.code !== 0) throw new Error(add.stderr || "Codex MCP 注册失败");
  } catch (error) {
    if (needsPath) await writeUserPath(oldUserPath);
    await restoreCodexConfig(snapshot);
    throw error;
  }
}

export async function setupRemove(): Promise<void> {
  const oldUserPath = await readUserPath();
  const next = oldUserPath.split(";").filter((entry) => entry && path.resolve(entry).toLowerCase() !== projectRoot.toLowerCase()).join(";");
  const snapshot = await backupCodexConfig();
  try {
    const remove = await runCodex(["mcp", "remove", mcpName]);
    if (remove.code !== 0 && !/not found|不存在/i.test(remove.stderr)) throw new Error(remove.stderr);
    await writeUserPath(next);
  } catch (error) {
    await writeUserPath(oldUserPath);
    await restoreCodexConfig(snapshot);
    throw error;
  }
}

async function runCodex(args: string[]) {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error("无法定位 APPDATA，不能调用 Codex CLI");
  const script = path.join(appData, "npm", "codex.ps1");
  await fs.access(script);
  return await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], undefined, 30000);
}

async function backupCodexConfig(): Promise<CodexConfigSnapshot> {
  const home = process.env.USERPROFILE;
  if (!home) throw new Error("无法定位用户目录，不能备份 Codex 配置");
  const source = path.join(home, ".codex", "config.toml");
  try { await fs.access(source); }
  catch { return { target: source, existed: false }; }
  const directory = path.join(projectRoot, "Config", "backups");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `config.${new Date().toISOString().replace(/[:.]/g, "-")}.toml.bak`);
  await fs.copyFile(source, target);
  return { target: source, existed: true, backupPath: target };
}

async function restoreCodexConfig(snapshot: CodexConfigSnapshot): Promise<void> {
  const home = process.env.USERPROFILE;
  if (!home) throw new Error("无法定位用户目录，不能恢复 Codex 配置");
  const expectedRoot = path.resolve(home, ".codex");
  const target = path.resolve(snapshot.target);
  if (!(target === expectedRoot || target.startsWith(`${expectedRoot}${path.sep}`))) throw new Error("拒绝恢复预期目录之外的 Codex 配置");
  if (snapshot.existed) {
    if (!snapshot.backupPath) throw new Error("Codex 配置备份缺失");
    await fs.copyFile(snapshot.backupPath, target);
  } else {
    await fs.rm(target, { force: true });
  }
}

async function readUserPath(): Promise<string> {
  const script = "$v=[Environment]::GetEnvironmentVariable('Path','User');[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v))";
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
