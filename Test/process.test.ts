import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../src/process.js";

test("命令超时会终止 Windows 子进程树", async (context) => {
  if (process.platform !== "win32") { context.skip("仅验证 Windows 进程树"); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dp-process-"));
  const pidFile = path.join(root, "child.pid");
  const script = [
    "const {spawn}=require('node:child_process');",
    "const fs=require('node:fs');",
    `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});`,
    `fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));`,
    "setInterval(()=>{},1000);"
  ].join("");
  try {
    await assert.rejects(run(process.execPath, ["-e", script], root, 500), /命令超时/);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const childPid = Number(await fs.readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(childPid, 0));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
