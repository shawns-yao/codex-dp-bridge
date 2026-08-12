import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDirectory, "..", "..");
export const defaultConfigPath = path.join(projectRoot, "Config", "default.json");
export const legacyUserConfigPath = path.join(projectRoot, "Config", "config.json");

export interface AppDirectories {
  configDirectory: string;
  stateDirectory: string;
  tempDirectory: string;
  logDirectory: string;
}

export interface AppDirectoryOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

export function resolveAppDirectories(options: AppDirectoryOptions = {}): AppDirectories {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const override = environment.CODEX_DP_HOME?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error("CODEX_DP_HOME 必须是绝对路径");
    const root = path.resolve(override);
    return {
      configDirectory: path.join(root, "Config"),
      stateDirectory: root,
      tempDirectory: path.join(root, "Temp"),
      logDirectory: path.join(root, "Log")
    };
  }

  if (platform === "win32") {
    const configRoot = absoluteEnvironmentDirectory(environment.APPDATA) ?? path.join(homeDirectory, "AppData", "Roaming");
    const stateRoot = path.join(absoluteEnvironmentDirectory(environment.LOCALAPPDATA) ?? path.join(homeDirectory, "AppData", "Local"), "codex-dp");
    return {
      configDirectory: path.join(configRoot, "codex-dp"),
      stateDirectory: stateRoot,
      tempDirectory: path.join(stateRoot, "Temp"),
      logDirectory: path.join(stateRoot, "Log")
    };
  }

  if (platform === "darwin") {
    const stateRoot = path.join(homeDirectory, "Library", "Application Support", "codex-dp");
    return {
      configDirectory: stateRoot,
      stateDirectory: stateRoot,
      tempDirectory: path.join(stateRoot, "Temp"),
      logDirectory: path.join(stateRoot, "Log")
    };
  }

  const configRoot = absoluteEnvironmentDirectory(environment.XDG_CONFIG_HOME) ?? path.join(homeDirectory, ".config");
  const stateRoot = path.join(absoluteEnvironmentDirectory(environment.XDG_STATE_HOME) ?? path.join(homeDirectory, ".local", "state"), "codex-dp");
  return {
    configDirectory: path.join(configRoot, "codex-dp"),
    stateDirectory: stateRoot,
    tempDirectory: path.join(stateRoot, "Temp"),
    logDirectory: path.join(stateRoot, "Log")
  };
}

function absoluteEnvironmentDirectory(value: string | undefined): string | undefined {
  return value && path.isAbsolute(value) ? path.resolve(value) : undefined;
}

const appDirectories = resolveAppDirectories();
export const configDirectory = appDirectories.configDirectory;
export const stateDirectory = appDirectories.stateDirectory;
export const configBackupDirectory = path.join(configDirectory, "backups");
export const userConfigPath = path.join(configDirectory, "config.json");
export const tempDirectory = appDirectories.tempDirectory;
export const logDirectory = appDirectories.logDirectory;
export const launcherDirectory = resolveLauncherDirectory();
export const launcherPath = process.platform === "win32" ? path.join(projectRoot, "codex-dp.cmd") : path.join(launcherDirectory, "codex-dp");
export const guardExtensionPath = path.join(projectRoot, "dist", "src", "pi-guard-extension.js");
export const mcpEntryPath = path.join(projectRoot, "dist", "src", "mcp.js");
export const cliEntryPath = path.join(projectRoot, "dist", "src", "cli.js");

function resolveLauncherDirectory(): string {
  if (process.platform === "win32") return projectRoot;
  const override = process.env.CODEX_DP_BIN_DIR?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error("CODEX_DP_BIN_DIR 必须是绝对路径");
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".local", "bin");
}
