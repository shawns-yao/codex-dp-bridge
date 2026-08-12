import fs from "node:fs/promises";
import path from "node:path";
import { run, type ProcessResult } from "./process.js";

export function parseCommandPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function findCommand(command: string): Promise<string> {
  if (path.isAbsolute(command)) {
    await fs.access(command);
    return command;
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await run(locator, [command]);
  if (result.code !== 0 || !result.stdout) throw new Error(`未在 PATH 中找到 ${command}`);
  const candidates = parseCommandPaths(result.stdout);
  if (candidates.length === 0) throw new Error(`未在 PATH 中找到 ${command}`);
  if (process.platform === "win32") {
    const preferred = candidates.find((candidate) => path.extname(candidate).toLowerCase() === ".ps1")
      ?? candidates.find((candidate) => /\.(cmd|bat)$/i.test(candidate));
    if (preferred) return preferred;
  }
  return candidates[0]!;
}

export async function runCommand(commandPath: string, args: string[], cwd?: string, timeoutMs = 30000): Promise<ProcessResult> {
  const extension = path.extname(commandPath).toLowerCase();
  if (extension === ".ps1") {
    const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const prefix = process.platform === "win32" ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] : ["-NoProfile", "-File"];
    return await run(powershell, [...prefix, commandPath, ...args], cwd, timeoutMs);
  }
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    const commandLine = [quoteWindowsCommandArg(commandPath), ...args.map(quoteWindowsCommandArg)].join(" ");
    return await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], cwd, timeoutMs);
  }
  return await run(commandPath, args, cwd, timeoutMs);
}

export function quoteWindowsCommandArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}
