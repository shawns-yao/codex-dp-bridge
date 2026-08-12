import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { cliEntryPath, launcherDirectory, launcherPath } from "./paths.js";
import { pathsEqual } from "./path-utils.js";

const launcherMarker = "# codex-dp managed launcher";

export interface UnixLauncherSnapshot {
  existed: boolean;
  content?: string;
  mode?: number;
}

export function renderUnixLauncher(nodePath: string, cliPath: string): string {
  return `#!/bin/sh\n${launcherMarker}\nexec ${shellQuote(nodePath)} ${shellQuote(cliPath)} "$@"\n`;
}

export async function installUnixLauncher(): Promise<UnixLauncherSnapshot | undefined> {
  if (process.platform === "win32") return undefined;
  await fs.mkdir(launcherDirectory, { recursive: true, mode: 0o755 });
  let snapshot: UnixLauncherSnapshot = { existed: false };
  try {
    const existing = await fs.readFile(launcherPath, "utf8");
    if (!existing.includes(launcherMarker)) throw new Error(`已存在同名启动入口：${launcherPath}`);
    const metadata = await fs.stat(launcherPath);
    snapshot = { existed: true, content: existing, mode: metadata.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicWriteFile(launcherPath, renderUnixLauncher(process.execPath, cliEntryPath));
  await fs.chmod(launcherPath, 0o755);
  return snapshot;
}

export async function restoreUnixLauncher(snapshot: UnixLauncherSnapshot | undefined): Promise<void> {
  if (process.platform === "win32" || !snapshot) return;
  if (!snapshot.existed) {
    await fs.rm(launcherPath, { force: true });
    return;
  }
  if (snapshot.content === undefined) throw new Error("启动入口备份缺失");
  await atomicWriteFile(launcherPath, snapshot.content);
  await fs.chmod(launcherPath, snapshot.mode ?? 0o755);
}

export async function removeUnixLauncher(): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const existing = await fs.readFile(launcherPath, "utf8");
    if (!existing.includes(launcherMarker)) throw new Error(`同名启动入口不属于 codex-dp：${launcherPath}`);
    await fs.rm(launcherPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function isLauncherDirectoryOnPath(environment: NodeJS.ProcessEnv = process.env): boolean {
  const entries = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  return entries.some((entry) => pathsEqual(entry, launcherDirectory));
}

export function pathInstruction(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform === "win32" || isLauncherDirectoryOnPath(environment)) return undefined;
  return `请将以下目录加入当前用户 PATH：\nexport PATH=${shellQuote(launcherDirectory)}:$PATH`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
