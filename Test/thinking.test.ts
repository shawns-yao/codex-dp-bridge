import test from "node:test";
import assert from "node:assert/strict";
import type { RpcClient } from "@earendil-works/pi-coding-agent";
import { applyThinkingLevel, isThinkingLevel } from "../src/thinking.js";

test("向 Pi RPC 传递最大思考强度", async () => {
  let applied: string | undefined;
  const client = {
    getAvailableThinkingLevels: async () => ["off", "high", "max"],
    setThinkingLevel: async (level: string) => { applied = level; }
  } as unknown as Pick<RpcClient, "getAvailableThinkingLevels" | "setThinkingLevel">;

  const available = await applyThinkingLevel(client, "max");

  assert.deepEqual(available, ["off", "high", "max"]);
  assert.equal(applied, "max");
});

test("拒绝当前模型不支持的自定义思考强度", async () => {
  let applied = false;
  const client = {
    getAvailableThinkingLevels: async () => ["off", "high"],
    setThinkingLevel: async () => { applied = true; }
  } as unknown as Pick<RpcClient, "getAvailableThinkingLevels" | "setThinkingLevel">;

  await assert.rejects(applyThinkingLevel(client, "max"), /可用等级：off, high/);
  assert.equal(applied, false);
});

test("思考强度只接受 Pi 支持的七个等级", () => {
  assert.equal(isThinkingLevel("minimal"), true);
  assert.equal(isThinkingLevel("max"), true);
  assert.equal(isThinkingLevel("ultra"), false);
});
