import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import type { PreflightResult } from "../../../src/desktop/preflight.js";
import type { DesktopPreferences, TextSize, Theme, UpdateChannel, WindowMode } from "../../../src/desktop/preferences.js";
import type { UpdateSnapshot } from "../../../src/desktop/updater.js";
import type { BindingSummary } from "../../../src/desktop/bindings.js";
import type { ConversationCard } from "../../../src/desktop/conversation-catalog.js";
import type { ConversationPairSummary } from "../../../src/desktop/conversation-pair.js";
import type { DialogueSpeaker, DualDialogueEvent, DualDialogueSnapshot } from "../../../src/desktop/dual-dialogue.js";

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
  updateState: "desktop:update-state",
  checkForUpdates: "desktop:check-for-updates",
  restartAndInstall: "desktop:restart-and-install",
  updateEvent: "desktop:update-event",
  listBindings: "desktop:list-bindings",
  createBinding: "desktop:create-binding",
  validateBinding: "desktop:validate-binding",
  disableBinding: "desktop:disable-binding",
  removeBinding: "desktop:remove-binding",
  discoverConversations: "desktop:discover-conversations",
  saveConversationPair: "desktop:save-conversation-pair",
  getConversationPair: "desktop:get-conversation-pair",
  clearConversationPair: "desktop:clear-conversation-pair",
  startDualDialogue: "desktop:start-dual-dialogue",
  pauseDualDialogue: "desktop:pause-dual-dialogue",
  resumeDualDialogue: "desktop:resume-dual-dialogue",
  stopDualDialogue: "desktop:stop-dual-dialogue",
  dualEvent: "desktop:dual-event",
  event: "desktop:event",
} as const;

export type { DesktopPreferences, TextSize, Theme, UpdateChannel, WindowMode } from "../../../src/desktop/preferences.js";

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

export interface DesktopBindingCreateInput { alias: string; projectRoot: string; threadId: string; }
export interface ConversationDiscoveryInput { projectRoot?: string; searchTerm?: string; }
export interface ConversationPairInput { workHandle: string; codexHandle: string; projectRoot: string; phase: string; point: string; objective: string; firstSpeaker: DialogueSpeaker; maxCycles: number; cycleTimeoutMs: number; }

export interface DesktopApi {
  getState(): Promise<DesktopStateResponse>;
  chooseProject(): Promise<{ canceled: boolean; projectRoot?: string }>;
  configure(input: DesktopConfigureInput): Promise<ConversationSnapshot>;
  start(): Promise<ConversationSnapshot>;
  pause(): Promise<ConversationSnapshot>;
  resume(): Promise<ConversationSnapshot>;
  submitDecision(response: string): Promise<ConversationSnapshot>;
  preflight(): Promise<PreflightResult>;
  updatePreferences(input: Partial<Pick<DesktopPreferences, "language" | "theme" | "windowMode" | "textSize" | "reduceMotion" | "autoScroll" | "autoUpdateEnabled" | "updateChannel">>): Promise<DesktopPreferences>;
  getUpdateState(): Promise<UpdateSnapshot>;
  checkForUpdates(): Promise<UpdateSnapshot>;
  restartAndInstall(): Promise<void>;
  onUpdate(listener: (snapshot: UpdateSnapshot) => void): () => void;
  stop(): Promise<ConversationSnapshot>;
  copyDiagnostic(): Promise<{ copied: boolean; diagnostic?: string }>;
  exportReport(): Promise<{ canceled: boolean; path?: string }>;
  resetPreferences(): Promise<void>;
  onEvent(listener: (event: ConversationEvent) => void): () => void;
  listBindings(): Promise<BindingSummary[]>;
  createBinding(input: DesktopBindingCreateInput): Promise<BindingSummary>;
  validateBinding(bindingId: string, projectRoot?: string): Promise<BindingSummary>;
  disableBinding(bindingId: string): Promise<void>;
  removeBinding(bindingId: string): Promise<void>;
  discoverConversations(input?: ConversationDiscoveryInput): Promise<ConversationCard[]>;
  saveConversationPair(input: ConversationPairInput): Promise<{ pair: ConversationPairSummary; snapshot: DualDialogueSnapshot }>;
  getConversationPair(): Promise<ConversationPairSummary | undefined>;
  clearConversationPair(): Promise<void>;
  startDualDialogue(): Promise<DualDialogueSnapshot>;
  pauseDualDialogue(): Promise<DualDialogueSnapshot>;
  resumeDualDialogue(): Promise<DualDialogueSnapshot>;
  stopDualDialogue(): Promise<DualDialogueSnapshot>;
  onDualEvent(listener: (event: DualDialogueEvent) => void): () => void;
}
