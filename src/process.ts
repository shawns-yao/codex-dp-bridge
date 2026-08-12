import { spawn } from "node:child_process";

export interface ProcessResult { code: number; stdout: string; stderr: string }

const processTreeQueryTimeoutMs = 5000;

export async function terminateProcessTree(pid: number | undefined, graceMs = 250): Promise<void> {
  if (!pid || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    await runKiller("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  const descendants = await findDescendants(pid);
  signalProcessTree(pid, descendants, "SIGTERM");
  if (graceMs > 0) await delay(graceMs);
  const remaining = [...new Set([...descendants, ...(await findDescendants(pid))])];
  signalProcessTree(pid, remaining, "SIGKILL");
}

function signalProcessTree(pid: number, descendants: number[], signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch { /* 非独立进程组时回退到逐进程终止 */ }
  for (const descendant of descendants) {
    try { process.kill(descendant, signal); } catch { /* 已退出或无权限 */ }
  }
  try { process.kill(pid, signal); } catch { /* 已退出或无权限 */ }
}

async function findDescendants(rootPid: number): Promise<number[]> {
  const result = await runRaw("ps", ["-eo", "pid=,ppid="], processTreeQueryTimeoutMs).catch(() => undefined);
  if (!result || result.code !== 0) return [];
  const children = new Map<number, number[]>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2) continue;
    const childPid = Number(fields[0]);
    const parentPid = Number(fields[1]);
    if (!Number.isInteger(childPid) || !Number.isInteger(parentPid)) continue;
    const siblings = children.get(parentPid) ?? [];
    siblings.push(childPid);
    children.set(parentPid, siblings);
  }
  const descendants: number[] = [];
  const visited = new Set<number>();
  const visit = (parentPid: number): void => {
    for (const childPid of children.get(parentPid) ?? []) {
      if (visited.has(childPid)) continue;
      visited.add(childPid);
      visit(childPid);
      descendants.push(childPid);
    }
  };
  visit(rootPid);
  return descendants;
}

async function runKiller(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn(command, args, { windowsHide: true, shell: false, stdio: "ignore" });
    const timer = setTimeout(() => {
      try { killer.kill(); } catch { /* 已退出 */ }
      resolve();
    }, processTreeQueryTimeoutMs);
    killer.once("error", () => { clearTimeout(timer); resolve(); });
    killer.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRaw(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
      reject(new Error(`命令超时：${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function run(command: string, args: string[], cwd?: string, timeoutMs = 30000): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child.pid).finally(() => reject(new Error(`命令超时：${command}`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); if (!timedOut) reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function runWithInput(command: string, args: string[], input: string, cwd?: string, timeoutMs = 30000): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child.pid).finally(() => reject(new Error(`命令超时：${command}`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); if (!timedOut) reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(input);
  });
}
