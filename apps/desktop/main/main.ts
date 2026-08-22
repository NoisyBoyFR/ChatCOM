import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, session } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationOrchestrator, type ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import { RelayFailure } from "../../../src/local-relay.js";
import { runDesktopPreflight, type PreflightResult } from "../../../src/desktop/preflight.js";
import { migratePreferences, preferencesForStorage, DEFAULT_PREFERENCES, type DesktopPreferences } from "../../../src/desktop/preferences.js";
import { translate } from "../../../src/desktop/i18n.js";
import { DESKTOP_IPC_CHANNELS, type DesktopConfigureInput } from "../shared/ipc.js";
import { CHATCOM_UPDATE_REPOSITORY, UpdaterController, evaluateUpdatePolicy, inspectWindowsAuthenticode, verifyArtifactHash, type ElectronUpdaterAdapter, type UpdateSnapshot } from "../../../src/desktop/updater.js";
import { APPROVED_PUBLISHER_SUBJECT } from "../../../src/desktop/publisher.js";

const orchestrator = new ConversationOrchestrator();
let mainWindow: BrowserWindow | undefined;
let closing = false;
let selectedProjectRoot: string | undefined;
let currentPreferences: DesktopPreferences = DEFAULT_PREFERENCES;
let updater: UpdaterController | undefined;
let updateSnapshot: UpdateSnapshot = { status: "DISABLED", currentVersion: "unknown", channel: "preview", readyToInstall: false, publicUpdatesEnabled: false, errorCode: "NOT_INITIALIZED" };
let currentPreflight: PreflightResult = {
  runtime: { status: "UNKNOWN" },
  authentication: { status: "UNKNOWN" },
  project: { status: "UNKNOWN" },
  security: "READ_ONLY",
  canStart: false,
};

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
  if ((value.maxCycles as number) < 1 || (value.maxCycles as number) > 20 || (value.cycleTimeoutMs as number) <= 0 || (value.globalTimeoutMs as number) <= 0) throw new RelayFailure("IPC_INPUT_INVALID");
  return value as unknown as DesktopConfigureInput;
}

async function preferencesPath(): Promise<string> {
  return join(app.getPath("userData"), "preferences.json");
}

async function loadPreferences(): Promise<DesktopPreferences> {
  try {
    const parsed: unknown = JSON.parse(await readFile(await preferencesPath(), "utf8"));
    return migratePreferences(parsed, app.getLocale());
  } catch {
    return migratePreferences(undefined, app.getLocale(), app.getVersion());
  }
}

async function savePreferences(preferences: DesktopPreferences): Promise<void> {
  currentPreferences = preferencesForStorage(preferences);
  await writeFile(await preferencesPath(), JSON.stringify(currentPreferences, null, 2), "utf8");
}

function applyWindowPreferences(): void {
  if (!mainWindow) return;
  if (currentPreferences.windowMode === "fullscreen") {
    mainWindow.setFullScreen(true);
    return;
  }
  mainWindow.setFullScreen(false);
  if (currentPreferences.windowMode === "maximized") mainWindow.maximize();
  else if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (currentPreferences.windowMode === "normal") mainWindow.setSize(1280, 820, true);
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

function sendUpdate(snapshot: UpdateSnapshot): void {
  updateSnapshot = snapshot;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DESKTOP_IPC_CHANNELS.updateEvent, snapshot);
}

async function findPackagedRenderer(): Promise<string | undefined> {
  const root = join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift() as string;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = join(current, entry.name);
      if (entry.isFile() && entry.name === "index.html") return candidate;
      if (entry.isDirectory()) pending.push(candidate);
    }
  }
  return undefined;
}

function sendEvent(event: import("../../../src/conversation/orchestrator.js").ConversationEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DESKTOP_IPC_CHANNELS.event, event);
  const snapshot = orchestrator.snapshot();
  const activity = ["RUNNING", "PAUSE_REQUESTED", "STOPPING"].includes(snapshot.state) ? snapshot.state as "RUNNING" | "PAUSE_REQUESTED" | "STOPPING" : "IDLE";
  updater?.setRelayState(activity, snapshot.cleanup === "CONFIRMED");
}

function handleSquirrelStartup(): boolean {
  if (process.platform !== "win32") return false;
  const event = process.argv.find((value) => value.startsWith("--squirrel-"));
  if (!event || event === "--squirrel-firstrun") return false;
  const updateExe = join(dirname(process.execPath), "Update.exe");
  const args = event === "--squirrel-uninstall" ? ["--removeShortcut", "ChatCOM.exe"] : ["--createShortcut", "ChatCOM.exe"];
  if (["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall"].includes(event) && existsSync(updateExe)) spawn(updateExe, args, { detached: true, windowsHide: true, stdio: "ignore" }).unref();
  app.quit();
  return true;
}

async function loadUpdateManifest(updateURL: string, expected: { currentVersion: string; channel: "stable" | "preview"; releaseVersion: string }): Promise<unknown> {
  const manifestURL = expected.channel === "stable"
    ? `https://github.com/${CHATCOM_UPDATE_REPOSITORY}/releases/download/v${encodeURIComponent(expected.releaseVersion)}/desktop-build-manifest.json`
    : new URL("desktop-build-manifest.json", updateURL).href;
  const response = await fetch(manifestURL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("MANIFEST_FETCH_FAILED");
  const manifest = await response.json() as { artifacts?: Array<{ kind?: unknown; filename?: unknown; sha256?: unknown }> };
  const fullPackage = manifest.artifacts?.find((artifact) => artifact.kind === "squirrel-full");
  if (!fullPackage || typeof fullPackage.filename !== "string" || typeof fullPackage.sha256 !== "string") throw new Error("MANIFEST_ARTIFACT_INVALID");
  const packageURL = expected.channel === "stable"
    ? `https://github.com/${CHATCOM_UPDATE_REPOSITORY}/releases/download/v${encodeURIComponent(expected.releaseVersion)}/${encodeURIComponent(fullPackage.filename)}`
    : new URL(fullPackage.filename, updateURL).href;
  const packageResponse = await fetch(packageURL, { signal: AbortSignal.timeout(30_000) });
  if (!packageResponse.ok) throw new Error("PACKAGE_FETCH_FAILED");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "chatcom-update-"));
  const temporaryPackage = join(temporaryDirectory, "update-full.nupkg");
  try {
    await writeFile(temporaryPackage, Buffer.from(await packageResponse.arrayBuffer()));
    if (!await verifyArtifactHash(temporaryPackage, fullPackage.sha256)) throw new Error("PACKAGE_HASH_INVALID");
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
  return manifest;
}

async function configureUpdater(): Promise<void> {
  const version = app.getVersion();
  const proof = await inspectWindowsAuthenticode(process.execPath);
  const policy = evaluateUpdatePolicy({ packaged: app.isPackaged, platform: process.platform, architecture: process.arch, currentVersion: version, channel: currentPreferences.updateChannel, signatureState: proof.signatureState, publisher: proof.publisher, timestamped: proof.timestamped, repository: CHATCOM_UPDATE_REPOSITORY, minimumUpdaterVersion: "1.0.0", approvedPublisherSubject: APPROVED_PUBLISHER_SUBJECT });
  const adapter: ElectronUpdaterAdapter = { setFeedURL: (options) => autoUpdater.setFeedURL(options), checkForUpdates: () => autoUpdater.checkForUpdates(), quitAndInstall: () => autoUpdater.quitAndInstall(), on: (event, listener) => autoUpdater.on(event as never, listener as never), removeListener: (event, listener) => autoUpdater.removeListener(event as never, listener as never) };
  updater = new UpdaterController({ adapter, currentVersion: version, channel: currentPreferences.updateChannel, policyEnabled: policy.enabled, publicUpdatesEnabled: currentPreferences.autoUpdateEnabled && policy.enabled, approvedPublisherSubject: APPROVED_PUBLISHER_SUBJECT, loadManifest: loadUpdateManifest, relayState: () => { const snapshot = orchestrator.snapshot(); const activity = ["RUNNING", "PAUSE_REQUESTED", "STOPPING"].includes(snapshot.state) ? snapshot.state as "RUNNING" | "PAUSE_REQUESTED" | "STOPPING" : "IDLE"; return { activity, cleanupConfirmed: snapshot.cleanup === "CONFIRMED" }; }, onChange: sendUpdate });
  updateSnapshot = updater.snapshot();
  if (policy.enabled && currentPreferences.autoUpdateEnabled) updater.start();
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.getState, async (event) => {
    try { assertTrustedSender(event); currentPreferences = await loadPreferences(); selectedProjectRoot = currentPreferences.projectRoot; return { snapshot: orchestrator.snapshot(), preferences: currentPreferences, preflight: currentPreflight }; }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.chooseProject, async (event) => {
    try {
      assertTrustedSender(event);
      const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, { title: translate(currentPreferences.language, "chooseProject"), properties: ["openDirectory", "createDirectory"] });
      if (result.canceled || result.filePaths[0] === undefined) return { canceled: true };
      selectedProjectRoot = await validateProject(result.filePaths[0]);
      await savePreferences({ ...currentPreferences, projectRoot: selectedProjectRoot });
      currentPreflight = { ...currentPreflight, project: { status: "UNKNOWN" }, canStart: false };
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
      currentPreferences = { ...currentPreferences, projectRoot: canonical, phase: input.phase, point: input.point, maxCycles: input.maxCycles };
      currentPreflight = { ...currentPreflight, project: { status: "UNKNOWN" }, canStart: false };
      await savePreferences(currentPreferences);
      return snapshot;
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.start, async (event) => {
    try {
      assertTrustedSender(event);
      if (selectedProjectRoot === undefined) throw new RelayFailure("PREFLIGHT_REQUIRED");
      currentPreflight = await runDesktopPreflight(selectedProjectRoot);
      if (!currentPreflight.canStart) throw new RelayFailure("PREFLIGHT_REQUIRED");
      void orchestrator.start().catch((error) => sendEvent({ kind: "diagnostic", diagnostic: { code: error instanceof RelayFailure ? error.code : "DESKTOP_START_FAILED", completedTransmissions: 0, cleanup: "NOT_CONFIRMED" } }));
      return orchestrator.snapshot();
    }
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
  ipcMain.handle(DESKTOP_IPC_CHANNELS.submitDecision, async (event, response: unknown) => {
    try { assertTrustedSender(event); if (typeof response !== "string") throw new RelayFailure("DECISION_RESPONSE_INVALID"); return orchestrator.submitDecision(response); }
    catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.preflight, async (event) => {
    try {
      assertTrustedSender(event);
      currentPreflight = selectedProjectRoot === undefined
        ? { runtime: { status: "UNKNOWN" }, authentication: { status: "UNKNOWN" }, project: { status: "ERROR" }, security: "READ_ONLY", canStart: false }
        : await runDesktopPreflight(selectedProjectRoot);
      return currentPreflight;
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.updatePreferences, async (event, rawInput: unknown) => {
    try {
      assertTrustedSender(event);
      if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) throw new RelayFailure("IPC_INPUT_INVALID");
      const value = rawInput as Record<string, unknown>;
      const allowed = ["language", "theme", "windowMode", "textSize", "reduceMotion", "autoScroll", "autoUpdateEnabled", "updateChannel"];
      if (Object.keys(value).some((key) => !allowed.includes(key))) throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "language") && typeof value.language !== "string") throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "theme") && !["system", "light", "dark"].includes(String(value.theme))) throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "windowMode") && !["normal", "maximized", "fullscreen"].includes(String(value.windowMode))) throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "textSize") && !["small", "normal", "large"].includes(String(value.textSize))) throw new RelayFailure("IPC_INPUT_INVALID");
      if (["reduceMotion", "autoScroll"].some((key) => Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== "boolean")) throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "autoUpdateEnabled") && typeof value.autoUpdateEnabled !== "boolean") throw new RelayFailure("IPC_INPUT_INVALID");
      if (Object.prototype.hasOwnProperty.call(value, "updateChannel") && !["stable", "preview"].includes(String(value.updateChannel))) throw new RelayFailure("IPC_INPUT_INVALID");
      await savePreferences(migratePreferences({ ...currentPreferences, ...value }, app.getLocale(), app.getVersion()));
      applyWindowPreferences();
      updater?.setChannel(currentPreferences.updateChannel);
      updater?.setEnabled(currentPreferences.autoUpdateEnabled);
      return currentPreferences;
    } catch (error) { throw boundedError(error); }
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.updateState, (event) => { assertTrustedSender(event); return updater?.snapshot() ?? updateSnapshot; });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.checkForUpdates, async (event) => { assertTrustedSender(event); return updater ? updater.checkNow() : updateSnapshot; });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.restartAndInstall, (event) => { assertTrustedSender(event); updater?.restartAndInstall(); });
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
    try { assertTrustedSender(event); try { await unlink(await preferencesPath()); } catch { /* absent is already reset */ } currentPreferences = migratePreferences(undefined, app.getLocale(), app.getVersion()); applyWindowPreferences(); updater?.setChannel(currentPreferences.updateChannel); updater?.setEnabled(currentPreferences.autoUpdateEnabled); }
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
    void dialog.showMessageBox(mainWindow as BrowserWindow, { type: "warning", buttons: [translate(currentPreferences.language, "cancel"), translate(currentPreferences.language, "stopAndQuit")], defaultId: 0, cancelId: 0, title: translate(currentPreferences.language, "relayState"), message: translate(currentPreferences.language, "closeWhileRunning") }).then(async (answer) => {
      if (answer.response !== 1) return;
      closing = true;
      await orchestrator.stop();
      mainWindow?.destroy();
    });
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else {
    const rendererPath = await findPackagedRenderer();
    if (!rendererPath || !existsSync(rendererPath)) { console.error("CHATCOM_DESKTOP kind=FAILURE code=RENDER_FILE_MISSING renderer=PACKAGED_MAIN_WINDOW"); return; }
    try { await mainWindow.loadFile(rendererPath); }
    catch { console.error("CHATCOM_DESKTOP kind=FAILURE code=RENDER_LOAD_FAILED"); }
  }
  applyWindowPreferences();
  mainWindow.show();
}

app.setAppUserModelId("com.squirrel.chatcom.ChatCOM");
const squirrelLaunchHandled = handleSquirrelStartup();

if (!squirrelLaunchHandled) app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  currentPreferences = await loadPreferences();
  selectedProjectRoot = currentPreferences.projectRoot;
  registerIpc();
  orchestrator.subscribe(sendEvent);
  await createWindow();
  await configureUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
