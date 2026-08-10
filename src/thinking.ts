import type { RpcClient } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS, type ThinkingLevel } from "./types.js";

type ThinkingClient = Pick<RpcClient, "getAvailableThinkingLevels" | "setThinkingLevel">;

export async function applyThinkingLevel(client: ThinkingClient, requested: ThinkingLevel): Promise<ThinkingLevel[]> {
  const available = (await client.getAvailableThinkingLevels()).filter(isThinkingLevel);
  if (!available.includes(requested)) {
    const supported = available.length ? available.join(", ") : "无";
    throw new Error(`当前模型不支持思考强度 ${requested}，可用等级：${supported}`);
  }
  await client.setThinkingLevel(requested);
  return available;
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}
