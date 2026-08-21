import { app, BrowserWindow, clipboard, dialog, ipcMain, session } from "electron";
import { existsSync } from "node:fs";
import { readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConversationOrchestrator, type ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import { RelayFailure } from "../../../src/local-relay.js";
import { DESKTOP_IPC_CHANNELS, type DesktopConfigureInput, type DesktopPreferences } from "../shared/ipc.js";

const orchestrator = new ConversationOrchestrator();
let mainWindow: BrowserWindow | undefined;
let closing = false;
let selectedProjectRoot: string | undefined;

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new RelayFailure("IPC_SENDER_INVALID");
}

function boundedError(error: unknown): Error {
  const code = error instanceof RelayFailure ? error.code : "DESKTOP_REQUEST_FAILED";
  return new Error(`CHATCOM_DESKTOP kind=FAILURE code=${code}`);
}

function requireInput(input: unknown): DesktopConfigureInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new RelayFailure("IPC_INPUT_INVALID");
  const value = input as Record<string, unknown>;
  const keys = ["projectRoot", "phase", "point", "mission", "maxCycles", "cycleTimeoutMs", "globalTimeoutMs"];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new RelayFailure("IPC_INPUT_INVALID");
  if (!["projectRoot", "phase", "point", "mission"].every((key) => typeof value[key] === "string")) throw new RelayFailure("IPC_INPUT_INVALID");
  if (!["maxCycles", "cycleTimeoutMs", "globalTimeoutMs"].every((key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]))) throw new RelayFailure("IPC_INPUT_INVALID");
  return value as unknown as DesktopConfigureInput;
}

async function preferencesPath(): Promise<string> {
  return join(app.getPath("userData"), "preferences.json");
}

async function loadPreferences(): Promise<DesktopPreferences> {
  try {
    const parsed: unknown = JSON.parse(await readFile(await preferencesPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    const preferences: DesktopPreferences = {};
    if (typeof value.projectRoot === "string") preferences.projectRoot = value.projectRoot;
    if (typeof value.phase === "string") preferences.phase = value.phase;
    if (typeof value.point === "string") preferences.point = value.point;
    if (typeof value.maxCycles === "number" && Number.isSafeInteger(value.maxCycles) && value.maxCycles >= 1 && value.maxCycles <= 20) preferences.maxCycles = value.maxCycles;
    return preferences;
  } catch {
    return {};
  }
}

async function savePreferences(input: DesktopConfigureInput): Promise<void> {
  const preferences: DesktopPreferences = { projectRoot: input.projectRoot, phase: input.phase, point: input.point, maxCycles: input.maxCycles };
  await writeFile(await preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
}

async function validateProject(path: string): Promise<string> {
  if (typeof path !== "string" || path.trim().length === 0) throw new RelayFailure("PROJECT_ROOT_INVALID");
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error("not-directory");
    return canonical;
  } catch {
    throw new RelayFailure("PROJECT_ROOT_UNAVAILABLE");
  }
}

function sendEvent(event: import("../../../src/conversation/orchestrator.js").ConversationEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DESKTOP_IPC_CHANNELS.event, event);
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.getState, async (event) => {
    try { assertTrustedSender(event); return { snapshot: orchestrator.snapshot(), preferences: await loadPreferences() }; }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.chooseProject, async (event) => {
    try {
      assertTrustedSender(event);
      const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, { title: "Choisir le projet à superviser", properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || result.filePaths[0] === undefined) return { canceled: true };
      selectedProjectRoot = await validateProject(result.filePaths[0]);
      return { canceled: false, projectRoot: selectedProjectRoot };
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.configure, async (event, rawInput: unknown) => {
    try {
      assertTrustedSender(event);
      const input = requireInput(rawInput);
      const canonical = await validateProject(input.projectRoot);
      if (selectedProjectRoot === undefined || canonical !== selectedProjectRoot) throw new RelayFailure("PROJECT_SELECTION_REQUIRED");
      const snapshot = orchestrator.configure({ ...input, projectRoot: canonical });
      await savePreferences(input);
      return snapshot;
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.start, async (event) => {
    try { assertTrustedSender(event); void orchestrator.start().catch((error) => sendEvent({ kind: "diagnostic", diagnostic: { code: error instanceof RelayFailure ? error.code : "DESKTOP_START_FAILED", completedTransmissions: 0, cleanup: "NOT_CONFIRMED" } })); return orchestrator.snapshot(); }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.pause, async (event) => {
    try { assertTrustedSender(event); return orchestrator.requestPause(); }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.resume, async (event) => {
    try { assertTrustedSender(event); void orchestrator.resume().catch((error) => sendEvent({ kind: "diagnostic", diagnostic: { code: error instanceof RelayFailure ? error.code : "DESKTOP_RESUME_FAILED", completedTransmissions: 0, cleanup: "NOT_CONFIRMED" } })); return orchestrator.snapshot(); }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.stop, async (event) => {
    try { assertTrustedSender(event); await orchestrator.stop(); return orchestrator.snapshot(); }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.copyDiagnostic, async (event) => {
    try {
      assertTrustedSender(event);
      const diagnostic = orchestrator.snapshot().lastDiagnostic;
      if (!diagnostic) return { copied: false };
      const text = JSON.stringify(diagnostic);
      clipboard.writeText(text);
      return { copied: true, diagnostic: text };
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.exportReport, async (event) => {
    try {
      assertTrustedSender(event);
      const result = await dialog.showSaveDialog(mainWindow as BrowserWindow, { title: "Exporter le compte rendu ChatCOM", defaultPath: join(app.getPath("documents"), "chatcom-report.json"), filters: [{ name: "JSON", extensions: ["json"] }] });
      if (result.canceled || result.filePath === undefined) return { canceled: true };
      await writeFile(result.filePath, await orchestrator.exportReport(), "utf8");
      return { canceled: false, path: result.filePath };
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.resetPreferences, async (event) => {
    try { assertTrustedSender(event); try { await unlink(await preferencesPath()); } catch { /* absent is already reset */ } }
    catch (error) { throw boundedError(error); }
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "ChatCOM Desktop",
    show: false,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL) => {
    let scheme = "unknown";
    try { scheme = new URL(validatedURL).protocol.replace(":", ""); } catch { /* bounded diagnostic */ }
    console.error(`CHATCOM_DESKTOP kind=FAILURE code=RENDER_LOAD_FAILED error_code=${errorCode} scheme=${scheme}`);
  });
  mainWindow.webContents.on("preload-error", (_event, _preloadPath, _error) => {
    console.error("CHATCOM_DESKTOP kind=FAILURE code=PRELOAD_FAILED");
  });
  mainWindow.on("close", (event) => {
    if (closing) return;
    if (!["RUNNING", "PAUSE_REQUESTED", "STOPPING"].includes(orchestrator.snapshot().state)) return;
    event.preventDefault();
    void dialog.showMessageBox(mainWindow as BrowserWindow, { type: "warning", buttons: ["Annuler", "Arrêter et quitter"], defaultId: 0, cancelId: 0, title: "Relais en cours", message: "ChatCOM doit terminer l’annulation et le nettoyage avant de quitter." }).then(async (answer) => {
      if (answer.response !== 1) return;
      closing = true;
      await orchestrator.stop();
      mainWindow?.destroy();
    });
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else {
    const rendererPath = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/apps/desktop/renderer/index.html`);
    if (!existsSync(rendererPath)) console.error("CHATCOM_DESKTOP kind=FAILURE code=RENDER_FILE_MISSING");
    try { await mainWindow.loadFile(rendererPath); }
    catch { console.error("CHATCOM_DESKTOP kind=FAILURE code=RENDER_LOAD_FAILED"); }
  }
  mainWindow.show();
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  orchestrator.subscribe(sendEvent);
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
