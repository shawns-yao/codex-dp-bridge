export type ImplementationMode = "patch" | "direct";
export type TaskPhase = "review" | "dispute" | "implementing" | "revising" | "completed" | "failed";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

export interface AppConfig {
  piCommand: string;
  compatiblePiRange: string;
  provider: string;
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel;
  defaultMode: ImplementationMode;
  analysisTimeoutMs: number;
  implementationTimeoutMs: number;
  revisionTimeoutMs: number;
  totalTimeoutMs: number;
  maxRevisionRounds: number;
  detailedLogging: boolean;
  sensitivePatterns: string[];
}

export interface ReviewInput {
  projectRoot: string;
  requirements: string;
  codexProposal: string;
  collaborationAuthorized: boolean;
  requestedModel?: string | undefined;
  requestedThinkingLevel?: ThinkingLevel | undefined;
}

export interface ImplementationInput {
  taskId: string;
  frozenPlan: string;
  allowedPaths: string[];
  implementationAuthorized: boolean;
  mode: ImplementationMode;
  includeUncommittedStateAuthorized?: boolean | undefined;
  binaryChangesAuthorized?: boolean | undefined;
}

export interface TaskRecord {
  id: string;
  projectRoot: string;
  phase: TaskPhase;
  createdAt: number;
  model: string;
  provider?: string;
  thinkingLevel: ThinkingLevel;
  revisionRounds: number;
  allowedPaths: string[];
  isolationPath?: string;
  baselinePath?: string | undefined;
  binaryChangesAuthorized: boolean;
  activeExecutionMs: number;
  ignoredFileCount?: number | undefined;
  lastResult?: string;
}

export interface PiInstallation {
  source: "bundled" | "configured";
  commandPath?: string;
  cliPath: string;
  version: string;
}
