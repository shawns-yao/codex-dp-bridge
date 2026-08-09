import { fileURLToPath } from "node:url";
import path from "node:path";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDirectory, "..", "..");
export const configDirectory = path.join(projectRoot, "Config");
export const defaultConfigPath = path.join(configDirectory, "default.json");
export const userConfigPath = path.join(configDirectory, "config.json");
export const tempDirectory = path.join(projectRoot, "Temp");
export const logDirectory = path.join(projectRoot, "Log");
export const guardExtensionPath = path.join(projectRoot, "dist", "src", "pi-guard-extension.js");
export const mcpEntryPath = path.join(projectRoot, "dist", "src", "mcp.js");
export const cliEntryPath = path.join(projectRoot, "dist", "src", "cli.js");
