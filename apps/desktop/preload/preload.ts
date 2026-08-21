import { contextBridge, ipcRenderer } from "electron";
import { DESKTOP_IPC_CHANNELS, type DesktopApi, type DesktopConfigureInput, type DesktopStateResponse } from "../shared/ipc.js";
import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";

const api: DesktopApi = Object.freeze({
  getState: (): Promise<DesktopStateResponse> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getState),
  chooseProject: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.chooseProject),
  configure: (input: DesktopConfigureInput): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.configure, input),
  start: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.start),
  pause: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.pause),
  resume: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resume),
  stop: (): Promise<ConversationSnapshot> => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.stop),
  copyDiagnostic: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.copyDiagnostic),
  exportReport: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.exportReport),
  resetPreferences: () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resetPreferences),
  onEvent: (listener: (event: ConversationEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ConversationEvent) => listener(value);
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.event, wrapped);
    return () => ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.event, wrapped);
  },
});

contextBridge.exposeInMainWorld("chatcomDesktop", api);
