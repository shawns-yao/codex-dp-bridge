import type { ModelInfo } from "@earendil-works/pi-coding-agent";

export interface ModelSelection {
  provider: string;
  model: string;
}

export function parseModelReference(value: string, fallbackProvider = ""): { provider?: string; model: string } {
  const reference = value.trim();
  if (!reference) return { model: "" };
  const separator = reference.indexOf("/");
  if (separator > 0 && separator < reference.length - 1) {
    return { provider: reference.slice(0, separator), model: reference.slice(separator + 1) };
  }
  return fallbackProvider ? { provider: fallbackProvider, model: reference } : { model: reference };
}

export function resolveModelSelection(models: readonly ModelInfo[], value: string, fallbackProvider = ""): ModelSelection | undefined {
  const reference = parseModelReference(value, fallbackProvider);
  if (!reference.model) return undefined;
  const matches = models.filter((model) => model.id === reference.model && (!reference.provider || model.provider === reference.provider));
  if (matches.length === 0) {
    const display = reference.provider ? `${reference.provider}/${reference.model}` : reference.model;
    throw new Error(`Pi 中没有可用模型：${display}`);
  }
  if (matches.length > 1) {
    const providers = matches.map((model) => model.provider).sort().join(", ");
    throw new Error(`模型 ${reference.model} 存在于多个供应商，请使用 provider/model 格式：${providers}`);
  }
  return { provider: matches[0]!.provider, model: matches[0]!.id };
}

export function modelReference(selection: ModelSelection | undefined): string | null {
  return selection ? `${selection.provider}/${selection.model}` : null;
}
