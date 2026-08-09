import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { run } from "./process.js";
import type { AppConfig, PiInstallation } from "./types.js";

async function findCommand(command: string): Promise<string> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = await run(locator, [command]);
  if (result.code !== 0 || !result.stdout) throw new Error(`未在 PATH 中找到 ${command}`);
  return result.stdout.split(/\r?\n/)[0]!.trim();
}

async function locateCli(commandPath: string): Promise<string> {
  const directory = path.dirname(commandPath);
  const candidates = [
    path.join(directory, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
    path.resolve(directory, "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
  ];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { continue; }
  }
  throw new Error("已找到 pi 命令，但无法定位官方 RPC CLI 入口");
}

export async function discoverPi(config: AppConfig): Promise<PiInstallation> {
  const commandPath = await findCommand(config.piCommand);
  const cliPath = await locateCli(commandPath);
  const result = await run(process.execPath, [cliPath, "--version"]);
  if (result.code !== 0) throw new Error(`无法读取 Pi 版本：${result.stderr}`);
  const version = semver.coerce(result.stdout)?.version;
  if (!version) throw new Error(`无法解析 Pi 版本：${result.stdout}`);
  if (!semver.satisfies(version, config.compatiblePiRange)) {
    throw new Error(`Pi ${version} 不兼容，已验证范围为 ${config.compatiblePiRange}。请由 Codex 告知用户升级或调整版本。`);
  }
  return { commandPath, cliPath, version };
}
