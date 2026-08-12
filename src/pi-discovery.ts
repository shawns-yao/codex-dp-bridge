import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { findCommand } from "./command-discovery.js";
import { run } from "./process.js";
import type { AppConfig, PiInstallation } from "./types.js";

const bundledPackageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const bundledCliPath = path.join(path.dirname(bundledPackageEntry), "cli.js");

export async function resolvePiCliCandidate(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const metadata = await fs.stat(resolved).catch(() => undefined);
  if (metadata?.isFile()) return resolved;
  if (!metadata?.isDirectory()) throw new Error(`Pi 路径不存在：${candidate}`);

  const candidates = [
    path.join(resolved, "dist", "cli.js"),
    path.join(resolved, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
    path.join(resolved, "packages", "coding-agent", "dist", "cli.js")
  ];
  for (const cliPath of candidates) {
    try {
      const cliMetadata = await fs.stat(cliPath);
      if (cliMetadata.isFile()) return cliPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`无法从指定路径定位 Pi RPC CLI：${candidate}`);
}

async function resolveConfiguredPi(value: string): Promise<{ commandPath?: string; cliPath: string }> {
  const directPath = path.isAbsolute(value) || /[\\/]/.test(value);
  if (directPath) return { cliPath: await resolvePiCliCandidate(value) };

  const commandPath = await findCommand(value);
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
  for (const cliPath of candidates) {
    try {
      const metadata = await fs.stat(cliPath);
      if (metadata.isFile()) return { commandPath, cliPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`已找到 Pi 命令，但无法定位 RPC CLI：${commandPath}`);
}

export async function discoverPi(config: AppConfig): Promise<PiInstallation> {
  const configured = process.env.CODEX_DP_PI?.trim() || config.piCommand.trim();
  const candidate = configured
    ? { ...(await resolveConfiguredPi(configured)), source: "configured" as const }
    : { cliPath: bundledCliPath, source: "bundled" as const };
  await fs.access(candidate.cliPath);

  const result = await run(process.execPath, [candidate.cliPath, "--version"]);
  if (result.code !== 0) throw new Error(`无法读取 Pi 版本：${result.stderr}`);
  const version = semver.coerce(result.stdout)?.version;
  if (!version) throw new Error(`无法解析 Pi 版本：${result.stdout}`);
  if (!semver.satisfies(version, config.compatiblePiRange)) {
    throw new Error(`Pi ${version} 不兼容，已验证范围为 ${config.compatiblePiRange}`);
  }
  return { ...candidate, version };
}
