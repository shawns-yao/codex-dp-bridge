import fs from "node:fs/promises";
import { z } from "zod";
import { defaultConfigPath, userConfigPath } from "./paths.js";
import { configDirectory } from "./paths.js";
import { atomicWriteFile } from "./atomic-write.js";
import type { AppConfig } from "./types.js";

const schema = z.object({
  piCommand: z.string().min(1),
  compatiblePiRange: z.string().min(1),
  provider: z.string().min(1),
  defaultModel: z.string(),
  defaultMode: z.enum(["patch", "direct"]),
  analysisTimeoutMs: z.number().int().positive(),
  implementationTimeoutMs: z.number().int().positive(),
  revisionTimeoutMs: z.number().int().positive(),
  totalTimeoutMs: z.number().int().positive(),
  maxRevisionRounds: z.number().int().min(0).max(10),
  detailedLogging: z.boolean(),
  sensitivePatterns: z.array(z.string().min(1))
});

async function readJson(pathname: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(pathname, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`配置文件格式损坏：${pathname}。请从 Config/backups 恢复最近备份。`);
    throw error;
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const base = await readJson(defaultConfigPath);
  let override: unknown = {};
  try {
    override = await readJson(userConfigPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return schema.parse({ ...(base as object), ...(override as object) });
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = schema.parse({ ...(await loadConfig()), ...patch });
  try {
    await fs.access(userConfigPath);
    const backupDirectory = `${configDirectory}/backups`;
    await fs.mkdir(backupDirectory, { recursive: true });
    const backupPath = `${backupDirectory}/config.${new Date().toISOString().replace(/[:.]/g, "-")}.json.bak`;
    await fs.copyFile(userConfigPath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicWriteFile(userConfigPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
