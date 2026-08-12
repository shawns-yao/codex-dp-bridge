import test from "node:test";
import assert from "node:assert/strict";
import { parseModelReference, resolveModelSelection } from "../src/model-selection.js";

const models = [
  { provider: "anthropic", id: "claude-sonnet", contextWindow: 200000, reasoning: true },
  { provider: "openai", id: "gpt-5", contextWindow: 400000, reasoning: true },
  { provider: "local", id: "shared", contextWindow: 32000, reasoning: false },
  { provider: "remote", id: "shared", contextWindow: 32000, reasoning: false }
];

test("模型引用支持 provider/model 格式", () => {
  assert.deepEqual(parseModelReference("openai/gpt-5"), { provider: "openai", model: "gpt-5" });
  assert.deepEqual(parseModelReference("gpt-5"), { model: "gpt-5" });
});

test("无供应商配置时可以选择任意唯一模型", () => {
  assert.deepEqual(resolveModelSelection(models, "gpt-5"), { provider: "openai", model: "gpt-5" });
});

test("同名模型要求显式指定供应商", () => {
  assert.throws(() => resolveModelSelection(models, "shared"), /多个供应商/);
});

test("空模型引用沿用 Pi 当前模型", () => {
  assert.equal(resolveModelSelection(models, ""), undefined);
});
