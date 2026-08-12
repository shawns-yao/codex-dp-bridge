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
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const homeDirectory = pathApi.resolve(options.homeDirectory ?? os.homedir());
  const override = environment.CODEX_DP_HOME?.trim();
  if (override) {
    if (!pathApi.isAbsolute(override)) throw new Error("CODEX_DP_HOME 必须是绝对路径");
    const root = pathApi.resolve(override);
    return {
      configDirectory: pathApi.join(root, "Config"),
      stateDirectory: root,
      tempDirectory: pathApi.join(root, "Temp"),
      logDirectory: pathApi.join(root, "Log")
    };
  }

  if (platform === "win32") {
    const configRoot = absoluteEnvironmentDirectory(environment.APPDATA, pathApi) ?? pathApi.join(homeDirectory, "AppData", "Roaming");
    const stateRoot = pathApi.join(absoluteEnvironmentDirectory(environment.LOCALAPPDATA, pathApi) ?? pathApi.join(homeDirectory, "AppData", "Local"), "codex-dp");
    return {
      configDirectory: pathApi.join(configRoot, "codex-dp"),
      stateDirectory: stateRoot,
      tempDirectory: pathApi.join(stateRoot, "Temp"),
      logDirectory: pathApi.join(stateRoot, "Log")
    };
  }

  if (platform === "darwin") {
    const stateRoot = pathApi.join(homeDirectory, "Library", "Application Support", "codex-dp");
    return {
      configDirectory: stateRoot,
      stateDirectory: stateRoot,
      tempDirectory: pathApi.join(stateRoot, "Temp"),
      logDirectory: pathApi.join(stateRoot, "Log")
    };
  }

  const configRoot = absoluteEnvironmentDirectory(environment.XDG_CONFIG_HOME, pathApi) ?? pathApi.join(homeDirectory, ".config");
  const stateRoot = pathApi.join(absoluteEnvironmentDirectory(environment.XDG_STATE_HOME, pathApi) ?? pathApi.join(homeDirectory, ".local", "state"), "codex-dp");
  return {
    configDirectory: pathApi.join(configRoot, "codex-dp"),
    stateDirectory: stateRoot,
    tempDirectory: pathApi.join(stateRoot, "Temp"),
    logDirectory: pathApi.join(stateRoot, "Log")
  };
}

function absoluteEnvironmentDirectory(value: string | undefined, pathApi: path.PlatformPath): string | undefined {
  return value && pathApi.isAbsolute(value) ? pathApi.resolve(value) : undefined;
}

const appDirectories = resolveAppDirectories();
export const configDirectory = appDirectories.configDirectory;
export const stateDirectory = appDirectories.stateDirectory;
export const configBackupDirectory = path.join(configDirectory, "backups");
export const userConfigPath = path.join(configDirectory, "config.json");
export const tempDirectory = appDirectories.tempDirectory;
export const logDirectory = appDirectories.logDirectory;
export const guardExtensionPath = path.join(projectRoot, "dist", "src", "pi-guard-extension.js");
export const mcpEntryPath = path.join(projectRoot, "dist", "src", "mcp.js");
export const cliEntryPath = path.join(projectRoot, "dist", "src", "cli.js");
