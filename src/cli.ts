#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { loadConfig, updateConfig } from "./config.js";
import { discoverPi } from "./pi-discovery.js";
import { tempDirectory } from "./paths.js";
import { setupApply, setupPreview, setupRemove } from "./setup.js";
import { cleanupTaskArtifacts } from "./workspace.js";

const [command = "status", subcommand, value] = process.argv.slice(2);

try {
  if (command === "status") {
    const config = await loadConfig();
    const pi = await discoverPi(config);
    print({ ok: true, node: process.version, pi, provider: config.provider, defaultModel: config.defaultModel || null });
  } else if (command === "doctor") {
    const config = await loadConfig();
    const pi = await discoverPi(config);
    const client = new RpcClient({ cliPath: pi.cliPath, cwd: process.cwd(), args: ["--no-session", "--tools", "read"] });
    await client.start();
    try {
      const models = (await client.getAvailableModels()).filter((model) => model.provider === config.provider);
      print({
        ok: models.length > 0,
        node: process.version,
        pi,
        provider: config.provider,
        authenticatedProviderModels: models,
        defaultModel: config.defaultModel || null,
        defaultModelAvailable: Boolean(config.defaultModel && models.some((model) => model.id === config.defaultModel))
      });
    } finally { await client.stop(); }
  } else if (command === "models") {
    const config = await loadConfig();
    const pi = await discoverPi(config);
    const client = new RpcClient({ cliPath: pi.cliPath, cwd: process.cwd(), args: ["--no-session", "--tools", "read"] });
    await client.start();
    try {
      const models = (await client.getAvailableModels()).filter((model) => model.provider === config.provider);
      print(models);
    } finally { await client.stop(); }
  } else if (command === "config" && subcommand === "show") {
    print(await loadConfig());
  } else if (command === "config" && subcommand === "set-model") {
    if (!value) throw new Error("缺少模型标识");
    print(await updateConfig({ defaultModel: value }));
  } else if (command === "live-test") {
    const config = await loadConfig();
    if (!config.defaultModel) throw new Error("请先配置默认模型");
    const pi = await discoverPi(config);
    const client = new RpcClient({
      cliPath: pi.cliPath,
      cwd: process.cwd(),
      provider: config.provider,
      model: config.defaultModel,
      args: ["--no-session", "--tools", "read"]
    });
    await client.start();
    try {
      await client.prompt("这是 codex-dp 真实联调。不要调用工具，只返回精确文本 CODEX_DP_LIVE_OK。");
      await client.waitForIdle(120000);
      const result = await client.getLastAssistantText();
      if (result?.trim() !== "CODEX_DP_LIVE_OK") throw new Error("真实模型返回未通过固定口令验证");
      print({ ok: true, provider: config.provider, model: config.defaultModel });
    } finally { await client.stop(); }
  } else if (command === "setup" && subcommand === "preview") {
    print(setupPreview());
  } else if (command === "setup" && subcommand === "apply") {
    await setupApply();
    print({ applied: true, preview: setupPreview() });
  } else if (command === "setup" && subcommand === "remove") {
    await setupRemove();
    print({ removed: true });
  } else if (command === "temp" && subcommand === "list") {
    await fs.mkdir(tempDirectory, { recursive: true });
    print(await fs.readdir(tempDirectory));
  } else if (command === "temp" && subcommand === "inspect") {
    if (!value) throw new Error("缺少任务标识");
    const target = path.resolve(tempDirectory, value);
    if (!target.startsWith(`${path.resolve(tempDirectory)}${path.sep}`)) throw new Error("拒绝读取 Temp 目录之外的路径");
    const failure = await fs.readFile(path.join(target, "failure.txt"), "utf8").catch(() => undefined);
    const policy = await fs.readFile(path.join(target, "policy.json"), "utf8").then((text) => JSON.parse(text) as { mode?: string; allowedPaths?: string[] }).catch(() => undefined);
    print({
      taskId: value,
      failure: failure || null,
      mode: policy?.mode || null,
      allowedPathCount: policy?.allowedPaths?.length ?? 0,
      hasWorktree: await exists(path.join(target, "worktree")),
      hasBaseline: await exists(path.join(target, "baseline"))
    });
  } else if (command === "temp" && subcommand === "clean") {
    if (!value) throw new Error("缺少任务标识");
    await cleanupTaskArtifacts(value);
    print({ cleaned: value });
  } else {
    throw new Error("未知命令。使用 status、doctor、models、config、live-test、setup 或 temp。" );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; }
  catch { return false; }
}
