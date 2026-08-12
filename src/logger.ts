import fs from "node:fs/promises";
import path from "node:path";
import { logDirectory } from "./paths.js";
import { redact } from "./security.js";

export async function logEvent(event: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const date = new Date().toISOString().slice(0, 10);
  const record = { timestamp: new Date().toISOString(), event, ...sanitize(data) };
  await fs.appendFile(path.join(logDirectory, `codex-dp-${date}.jsonl`), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (/prompt|source|patch|response|key|token|secret/i.test(key)) return [key, "<omitted>"];
    if (typeof value === "string") return [key, redact(value).replace(/[A-Za-z]:\\[^\s]+/g, "<path>")];
    return [key, value];
  }));
}
