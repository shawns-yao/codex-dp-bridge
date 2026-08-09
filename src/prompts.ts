export function reviewPrompt(requirements: string, proposal: string): string {
  return `你是 codex-dp 的独立技术审查者。只允许分析和读取，不允许修改文件或执行命令。工具调用总量不得超过 20 次，不需要穷举整个仓库；证据充分后立即停止检索并返回结论。\n\n原始需求：\n${requirements}\n\nCodex 初步方案：\n${proposal}\n\n请进行一轮独立反方审查，检查需求误解、现有能力复用、调用链、架构过度设计、边界条件、验证与回滚。不要为了反对而反对。即使证据不完整，也必须返回最终结构化结果并在风险中说明。\n\n使用以下标记返回 JSON：\n<<<CODEX_DP_REVIEW>>>\n{"conclusion":"agree|disagree","summary":"...","issues":["..."],"suggestions":["..."],"technicalDisputes":[{"topic":"...","deepseekPosition":"...","evidence":"..."}],"risks":["..."]}\n<<<END_CODEX_DP_REVIEW>>>`;
}

export function disputePrompt(message: string): string {
  return `这是明确技术分歧的第二轮，也是最后一轮自动讨论。请针对以下 Codex 意见提供可核验依据，不得修改文件：\n${message}\n\n继续使用 CODEX_DP_REVIEW 标记返回更新后的 JSON。`;
}

export function patchPrompt(frozenPlan: string, allowedPaths: string[]): string {
  return `架构已经由用户授权并冻结。你负责生成实现代码，但不能直接写入文件，也不能执行命令。\n\n冻结方案：\n${frozenPlan}\n\n允许修改范围：\n${allowedPaths.join("\n")}\n\n请读取必要代码并生成标准 unified diff。补丁只能包含批准范围。需要命令验证时仅提出申请。\n\n返回格式：\n<<<CODEX_DP_PATCH>>>\n标准 unified diff\n<<<END_CODEX_DP_PATCH>>>\n<<<CODEX_DP_META>>>\n{"summary":"...","changedPaths":["..."],"requestedCommands":[{"command":"...","reason":"..."}],"risks":["..."]}\n<<<END_CODEX_DP_META>>>`;
}

export function directPrompt(frozenPlan: string, allowedPaths: string[], isolationPath: string): string {
  return `架构已经由用户授权并冻结。现在使用直接修改模式，但只能修改隔离工作区。不要执行命令。\n\n隔离工作区绝对路径：${isolationPath}\n冻结方案：\n${frozenPlan}\n允许修改范围：\n${allowedPaths.join("\n")}\n\n所有读取和写入都必须显式使用隔离工作区中的路径。完成后返回摘要、修改路径、命令申请和风险，不要输出完整文件正文。`;
}

export function revisionPrompt(feedback: string, mode: "patch" | "direct"): string {
  const output = mode === "patch" ? "返回完整修订补丁和元数据标记。" : "直接修订隔离工作区并返回摘要。";
  return `这是实施修订。只能处理已经批准的范围，不得扩大架构或执行命令。\n\nCodex 审查或验证反馈：\n${feedback}\n\n${output}`;
}
