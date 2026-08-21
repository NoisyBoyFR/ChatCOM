import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";

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
  event: "desktop:event",
} as const;

export interface DesktopPreferences {
  projectRoot?: string;
  phase?: string;
  point?: string;
  maxCycles?: number;
}

export interface DesktopStateResponse {
  snapshot: ConversationSnapshot;
  preferences: DesktopPreferences;
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
  stop(): Promise<ConversationSnapshot>;
  copyDiagnostic(): Promise<{ copied: boolean; diagnostic?: string }>;
  exportReport(): Promise<{ canceled: boolean; path?: string }>;
  resetPreferences(): Promise<void>;
  onEvent(listener: (event: ConversationEvent) => void): () => void;
}
