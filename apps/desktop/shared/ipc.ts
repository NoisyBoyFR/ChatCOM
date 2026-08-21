import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import type { PreflightResult } from "../../../src/desktop/preflight.js";
import type { DesktopPreferences, TextSize, Theme, WindowMode } from "../../../src/desktop/preferences.js";

export const DESKTOP_IPC_CHANNELS = {
  getState: "desktop:get-state",
  chooseProject: "desktop:choose-project",
  configure: "desktop:configure",
  start: "desktop:start",
  pause: "desktop:pause",
  resume: "desktop:resume",
  stop: "desktop:stop",
  copyDiagnostic: "desktop:copy-diagnostic",
  exportReport: "desktop:export-report",
  resetPreferences: "desktop:reset-preferences",
  preflight: "desktop:preflight",
  submitDecision: "desktop:submit-decision",
  updatePreferences: "desktop:update-preferences",
  event: "desktop:event",
} as const;

export type { DesktopPreferences, TextSize, Theme, WindowMode } from "../../../src/desktop/preferences.js";

export interface DesktopStateResponse {
  snapshot: ConversationSnapshot;
  preferences: DesktopPreferences;
  preflight: PreflightResult;
}

export interface DesktopConfigureInput {
  projectRoot: string;
  phase: string;
  point: string;
  mission: string;
  maxCycles: number;
  cycleTimeoutMs: number;
  globalTimeoutMs: number;
}

export interface DesktopApi {
  getState(): Promise<DesktopStateResponse>;
  chooseProject(): Promise<{ canceled: boolean; projectRoot?: string }>;
  configure(input: DesktopConfigureInput): Promise<ConversationSnapshot>;
  start(): Promise<ConversationSnapshot>;
  pause(): Promise<ConversationSnapshot>;
  resume(): Promise<ConversationSnapshot>;
  submitDecision(response: string): Promise<ConversationSnapshot>;
  preflight(): Promise<PreflightResult>;
  updatePreferences(input: Partial<Pick<DesktopPreferences, "language" | "theme" | "windowMode" | "textSize" | "reduceMotion" | "autoScroll">>): Promise<DesktopPreferences>;
  stop(): Promise<ConversationSnapshot>;
  copyDiagnostic(): Promise<{ copied: boolean; diagnostic?: string }>;
  exportReport(): Promise<{ canceled: boolean; path?: string }>;
  resetPreferences(): Promise<void>;
  onEvent(listener: (event: ConversationEvent) => void): () => void;
}
