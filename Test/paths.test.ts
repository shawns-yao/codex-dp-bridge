import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveAppDirectories } from "../src/paths.js";

test("Windows 使用用户级配置和本地状态目录", () => {
  const directories = resolveAppDirectories({
    platform: "win32",
    homeDirectory: "C:/Users/example",
    environment: { APPDATA: "C:/Users/example/AppData/Roaming", LOCALAPPDATA: "C:/Users/example/AppData/Local" }
  });
  assert.equal(directories.configDirectory, path.win32.resolve("C:/Users/example/AppData/Roaming/codex-dp"));
  assert.equal(directories.tempDirectory, path.win32.resolve("C:/Users/example/AppData/Local/codex-dp/Temp"));
});

test("macOS 使用 Application Support 目录", () => {
  const directories = resolveAppDirectories({ platform: "darwin", homeDirectory: "/Users/example", environment: {} });
  assert.equal(directories.configDirectory, "/Users/example/Library/Application Support/codex-dp");
  assert.equal(directories.logDirectory, "/Users/example/Library/Application Support/codex-dp/Log");
});

test("Linux 遵循 XDG 配置和状态目录", () => {
  const directories = resolveAppDirectories({
    platform: "linux",
    homeDirectory: "/home/example",
    environment: { XDG_CONFIG_HOME: "/mnt/config", XDG_STATE_HOME: "/mnt/state" }
  });
  assert.equal(directories.configDirectory, "/mnt/config/codex-dp");
  assert.equal(directories.tempDirectory, "/mnt/state/codex-dp/Temp");
});

test("CODEX_DP_HOME 为三平台提供统一覆盖目录", () => {
  const directories = resolveAppDirectories({ platform: "linux", homeDirectory: "/home/example", environment: { CODEX_DP_HOME: "/srv/codex-dp" } });
  assert.equal(directories.configDirectory, "/srv/codex-dp/Config");
  assert.equal(directories.logDirectory, "/srv/codex-dp/Log");
  assert.throws(() => resolveAppDirectories({ platform: "linux", homeDirectory: "/home/example", environment: { CODEX_DP_HOME: "relative" } }), /绝对路径/);
});
