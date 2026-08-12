import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { findCommand } from "./command-discovery.js";
import { run } from "./process.js";
import type { AppConfig, PiInstallation } from "./types.js";

async function locateCli(commandPath: string): Promise<string> {
  const resolvedCommandPath = await fs.realpath(commandPath).catch(() => commandPath);
  const directories = [...new Set([path.dirname(commandPath), path.dirname(resolvedCommandPath)])];
  const candidates = [
    ...(path.extname(resolvedCommandPath).toLowerCase() === ".js" ? [resolvedCommandPath] : []),
    ...directories.flatMap((directory) => [
      path.join(directory, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
      path.resolve(directory, "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
      path.resolve(directory, "..", "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
    ])
  ];
  const visited = new Set<string>();
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue;
    visited.add(candidate);
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
