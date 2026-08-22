import { contextBridge, ipcRenderer } from "electron";
import { DESKTOP_IPC_CHANNELS, type DesktopApi, type DesktopConfigureInput, type DesktopStateResponse, type DesktopBindingCreateInput } from "../shared/ipc.js";
import type { DesktopPreferences } from "../../../src/desktop/preferences.js";
import type { UpdateSnapshot } from "../../../src/desktop/updater.js";
import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import type { PreflightResult } from "../../../src/desktop/preflight.js";

const api: DesktopApi = Object.freeze({
  getState: (): Promise<DesktopStateResponse> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getState),
  chooseProject: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.chooseProject),
  configure: (input: DesktopConfigureInput): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.configure, input),
  start: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.start),
  pause: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.pause),
  resume: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resume),
  submitDecision: (response: string): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.submitDecision, response),
  preflight: (): Promise<PreflightResult> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.preflight),
  updatePreferences: (input: Partial<Pick<DesktopPreferences, "language" | "theme" | "windowMode" | "textSize" | "reduceMotion" | "autoScroll" | "autoUpdateEnabled" | "updateChannel">>) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updatePreferences, input),
  getUpdateState: (): Promise<UpdateSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateState),
  checkForUpdates: (): Promise<UpdateSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.checkForUpdates),
  restartAndInstall: (): Promise<void> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.restartAndInstall),
  onUpdate: (listener: (snapshot: UpdateSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: UpdateSnapshot) => listener(value);
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.updateEvent, wrapped);
    return () => ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.updateEvent, wrapped);
  },
  stop: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.stop),
  copyDiagnostic: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.copyDiagnostic),
  exportReport: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.exportReport),
  resetPreferences: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resetPreferences),
  onEvent: (listener: (event: ConversationEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ConversationEvent) => listener(value);
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.event, wrapped);
    return () => ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.event, wrapped);
  },
  listBindings: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.listBindings),
  createBinding: (input: DesktopBindingCreateInput) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.createBinding, input),
  validateBinding: (bindingId: string, projectRoot?: string) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.validateBinding, bindingId, projectRoot),
  disableBinding: (bindingId: string) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.disableBinding, bindingId),
  removeBinding: (bindingId: string) => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.removeBinding, bindingId),
});

contextBridge.exposeInMainWorld("chatcomDesktop", api);
