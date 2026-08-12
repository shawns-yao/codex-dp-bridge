import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { configBackupDirectory, defaultConfigPath, legacyUserConfigPath, userConfigPath } from "./paths.js";
import { atomicWriteFile } from "./atomic-write.js";
import { THINKING_LEVELS, type AppConfig } from "./types.js";

const schema = z.object({
  piCommand: z.string().min(1),
  compatiblePiRange: z.string().min(1),
  provider: z.string().min(1),
  defaultModel: z.string(),
  defaultThinkingLevel: z.enum(THINKING_LEVELS),
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
    if (error instanceof SyntaxError) throw new Error(`配置文件格式损坏：${pathname}。请从 ${configBackupDirectory} 恢复最近备份。`);
    throw error;
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const base = await readJson(defaultConfigPath);
  let override: unknown = {};
  const source = await findUserConfigPath();
  if (source) override = await readJson(source);
  return schema.parse({ ...(base as object), ...(override as object) });
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = schema.parse({ ...(await loadConfig()), ...patch });
  const source = await findUserConfigPath();
  if (source) {
    await fs.mkdir(configBackupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = path.join(configBackupDirectory, `config.${new Date().toISOString().replace(/[:.]/g, "-")}.json.bak`);
    await fs.copyFile(source, backupPath);
  }
  await atomicWriteFile(userConfigPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function findUserConfigPath(): Promise<string | undefined> {
  for (const candidate of [userConfigPath, legacyUserConfigPath]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
