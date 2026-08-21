import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import { detectLocale, isSupportedLocale, translate, type I18nKey, type Locale } from "../../../src/desktop/i18n.js";
import type { DesktopPreferences, Theme, TextSize, UpdateChannel, WindowMode } from "../../../src/desktop/preferences.js";
import type { UpdateSnapshot } from "../../../src/desktop/updater.js";
import { SettingsSession, type EditablePreferences } from "../../../src/desktop/settings-session.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const projectRoot = $("project-root") as HTMLInputElement;
const phase = $("phase") as HTMLInputElement;
const point = $("point") as HTMLInputElement;
const mission = $("mission") as HTMLTextAreaElement;
const maxCycles = $("max-cycles") as HTMLInputElement;
const cycleTimeout = $("cycle-timeout") as HTMLInputElement;
const globalTimeout = $("global-timeout") as HTMLInputElement;
const stateBadge = $("state-badge");
const configurationStatus = $("configuration-status");
const footerStatus = $("footer-status");
const timeline = $("timeline");
const decisionPanel = $("decision-panel");
const decisionQuestion = $("decision-question");
const decisionResponse = $("decision-response") as HTMLTextAreaElement;
const settingsPanel = $("settings-panel");
const settingsStatus = $("settings-status");
const settingsCard = settingsPanel.querySelector(".settings-card") as HTMLElement;
const settingsSave = $("save-settings") as HTMLButtonElement;
const settingsCancel = $("cancel-settings") as HTMLButtonElement;
const checkUpdates = $("check-updates") as HTMLButtonElement;
const restartUpdate = $("restart-update") as HTMLButtonElement;
const updateState = $("update-state");
const settingsSession = new SettingsSession();
let snapshot: ConversationSnapshot | undefined;
let preferences: DesktopPreferences | undefined;
let preflight: import("../../../src/desktop/preflight.js").PreflightResult | undefined;
let locale: Locale = detectLocale(navigator.language);
let settingsTrigger: HTMLElement | undefined;
let settingsStatusTimer: number | undefined;

const t = (key: I18nKey, params: Record<string, string | number> = {}): string => translate(locale, key, params);
function setStatus(text: string): void { footerStatus.textContent = text; }
function setLanguage(next: Locale): void {
  locale = next;
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n as I18nKey); });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => { element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder as I18nKey)); });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAria as I18nKey)); });
  updateMissionCount();
}
function applyDisplaySettings(next: DesktopPreferences): void {
  document.documentElement.dataset.theme = next.theme;
  document.documentElement.dataset.textSize = next.textSize;
  document.documentElement.dataset.reduceMotion = String(next.reduceMotion);
  document.documentElement.dataset.autoScroll = String(next.autoScroll);
}
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "CHATCOM_DESKTOP kind=FAILURE code=REQUEST_FAILED";
  configurationStatus.textContent = /^CHATCOM_DESKTOP kind=FAILURE code=[A-Z0-9_]+$/u.test(message) ? message : "CHATCOM_DESKTOP kind=FAILURE code=REQUEST_FAILED";
  configurationStatus.className = "hint error";
  setStatus(t("interventionNeeded"));
}
function updateMissionCount(): void { $("mission-count").textContent = `${new TextEncoder().encode(mission.value).length} / 16384 bytes`; }
function validateForm(): HTMLElement | undefined {
  const checks: Array<[HTMLInputElement | HTMLTextAreaElement, HTMLElement, I18nKey]> = [[projectRoot, $("project-error"), "projectRequired"], [phase, $("phase-error"), "phaseRequired"], [point, $("point-error"), "pointRequired"], [mission, $("mission-error"), "missionRequired"]];
  for (const [, error] of checks) error.textContent = "";
  for (const [control, error, key] of checks) if (control.value.trim().length === 0) { error.textContent = t(key); return control; }
  const cycles = Number(maxCycles.value);
  $("cycles-error").textContent = Number.isInteger(cycles) && cycles >= 1 && cycles <= 20 ? "" : t("cyclesRange");
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 20) return maxCycles;
  const cycleLimit = Number(cycleTimeout.value);
  const globalLimit = Number(globalTimeout.value);
  $("cycle-timeout-error").textContent = Number.isSafeInteger(cycleLimit) && cycleLimit > 0 ? "" : t("invalidNumber");
  $("global-timeout-error").textContent = Number.isSafeInteger(globalLimit) && globalLimit > 0 ? "" : t("invalidNumber");
  if (!Number.isSafeInteger(cycleLimit) || cycleLimit <= 0) return cycleTimeout;
  if (!Number.isSafeInteger(globalLimit) || globalLimit <= 0) return globalTimeout;
  return undefined;
}
function renderSnapshot(next: ConversationSnapshot): void {
  snapshot = next;
  stateBadge.textContent = next.state;
  stateBadge.className = `badge state-${next.state.toLowerCase()}`;
  $("conversation-id").textContent = next.conversationId;
  $("cycle").textContent = `${next.cycle} / ${next.maxCycles}`;
  $("elapsed").textContent = `${Math.floor(next.elapsedMs / 1000)} s`;
  $("cleanup").textContent = next.cleanup;
  $("session-id").textContent = next.currentSessionId ?? "—";
  const running = ["RUNNING", "PAUSE_REQUESTED", "STOPPING"].includes(next.state);
  $("start").toggleAttribute("disabled", running || !["READY", "PAUSED"].includes(next.state) || preflight?.canStart !== true);
  $("pause").toggleAttribute("disabled", next.state !== "RUNNING");
  $("resume").toggleAttribute("disabled", next.state !== "PAUSED");
  $("stop").toggleAttribute("disabled", !running && !["READY", "PAUSED"].includes(next.state));
  decisionPanel.toggleAttribute("hidden", next.state !== "USER_DECISION_REQUIRED");
  decisionQuestion.textContent = next.decisionPrompt ?? "";
  $("submit-decision").toggleAttribute("disabled", next.state !== "USER_DECISION_REQUIRED");
  if (next.state === "USER_DECISION_REQUIRED") configurationStatus.textContent = t("decisionNeeded");
}
function renderPreflight(next: import("../../../src/desktop/preflight.js").PreflightResult): void {
  preflight = next;
  $("runtime-status").textContent = next.runtime.status;
  $("auth-status").textContent = next.authentication.status;
  $("project-status").textContent = next.project.status;
  $("security-status").textContent = t("readOnly");
  $("start").toggleAttribute("disabled", snapshot === undefined || !["READY", "PAUSED"].includes(snapshot.state) || next.canStart !== true);
  configurationStatus.textContent = next.canStart ? t("preflightReady") : t("preflightRequired");
  configurationStatus.className = next.canStart ? "hint" : "hint error";
}
function renderTransmission(cycle: number, message: Extract<ConversationEvent, { kind: "transmission" }>["message"]): void {
  const card = document.createElement("article"); card.className = `message-card ${message.sender === "WORK_LOCAL" ? "work" : "codex"}`;
  const heading = document.createElement("div"); heading.className = "message-heading"; heading.textContent = `${message.sender} → ${message.recipient} · ${message.type} · ${t("cycle")} ${cycle}`;
  const meta = document.createElement("div"); meta.className = "message-meta"; meta.textContent = `${message.created_at} · sequence ${message.sequence} · ${message.delivery_status}`;
  const content = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = t("showContent"); const body = document.createElement("p"); body.textContent = message.content; content.append(summary, body); card.append(heading, meta, content); timeline.append(card);
  if (preferences?.autoScroll !== false) timeline.scrollTop = timeline.scrollHeight;
}
function handleEvent(event: ConversationEvent): void {
  if (event.kind === "snapshot") renderSnapshot(event.snapshot);
  else if (event.kind === "transmission") renderTransmission(event.cycle, event.message);
  else if (event.kind === "cycle_started") setStatus(t("cycleStarted", { cycle: event.cycle }));
  else if (event.kind === "cycle_completed") setStatus(t("cycleCompleted", { cycle: event.cycle }));
  else if (event.kind === "diagnostic") { const diagnostic = event.diagnostic; setStatus(`${diagnostic.code}`); configurationStatus.textContent = `${diagnostic.relayStage ?? "—"} · ${diagnostic.completedTransmissions} · ${diagnostic.cleanup} · ${diagnostic.failureCategory ?? "UNKNOWN"}`; }
}
function setSettingsControls(next: EditablePreferences): void {
  ($("language") as HTMLSelectElement).value = next.language;
  ($("theme") as HTMLSelectElement).value = next.theme;
  ($("window-mode") as HTMLSelectElement).value = next.windowMode;
  ($("text-size") as HTMLSelectElement).value = next.textSize;
  ($("reduce-motion") as HTMLInputElement).checked = next.reduceMotion;
  ($("auto-scroll") as HTMLInputElement).checked = next.autoScroll;
  ($("auto-update") as HTMLInputElement).checked = next.autoUpdateEnabled;
  ($("update-channel") as HTMLSelectElement).value = next.updateChannel;
}
function readSettingsControls(): EditablePreferences {
  return {
    language: ($("language") as HTMLSelectElement).value as EditablePreferences["language"],
    theme: ($("theme") as HTMLSelectElement).value as Theme,
    windowMode: ($("window-mode") as HTMLSelectElement).value as WindowMode,
    textSize: ($("text-size") as HTMLSelectElement).value as TextSize,
    reduceMotion: ($("reduce-motion") as HTMLInputElement).checked,
    autoScroll: ($("auto-scroll") as HTMLInputElement).checked,
    autoUpdateEnabled: ($("auto-update") as HTMLInputElement).checked,
    updateChannel: ($("update-channel") as HTMLSelectElement).value as UpdateChannel,
  };
}
function setSettingsBusy(busy: boolean): void {
  settingsSave.disabled = busy;
  settingsCancel.disabled = busy;
  settingsPanel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((control) => { control.disabled = busy; });
}
function renderUpdateState(next: UpdateSnapshot): void {
  updateState.textContent = next.availableVersion ? `${next.status} ${next.availableVersion}` : next.status;
  restartUpdate.hidden = !next.readyToInstall;
  checkUpdates.disabled = next.status === "CHECKING" || !next.publicUpdatesEnabled;
}
function closeSettings(): void {
  settingsPanel.hidden = true;
  settingsStatus.textContent = "";
  settingsStatus.className = "hint";
  const trigger = settingsTrigger;
  settingsTrigger = undefined;
  if (trigger && trigger.isConnected) trigger.focus();
}
function openSettings(): void {
  if (!preferences || settingsSession.isOpen()) return;
  settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  settingsSession.open(preferences);
  setSettingsControls(settingsSession.snapshot());
  settingsStatus.textContent = "";
  settingsStatus.className = "hint";
  setSettingsBusy(false);
  settingsPanel.hidden = false;
  settingsCard.focus();
}
function cancelSettings(): void {
  if (!settingsSession.cancel()) return;
  if (preferences) setSettingsControls(preferences);
  closeSettings();
}
async function saveSettings(): Promise<void> {
  if (!settingsSession.isOpen() || !settingsSession.beginSave()) return;
  const draft = readSettingsControls();
  if (!isSupportedLocale(draft.language) || !["system", "light", "dark"].includes(draft.theme) || !["normal", "maximized", "fullscreen"].includes(draft.windowMode) || !["small", "normal", "large"].includes(draft.textSize) || !["stable", "preview"].includes(draft.updateChannel)) {
    settingsSession.failSave();
    settingsStatus.textContent = t("settingsSaveFailed");
    settingsStatus.className = "hint error";
    return;
  }
  setSettingsBusy(true);
  try {
    preferences = await window.chatcomDesktop.updatePreferences(draft);
    settingsSession.completeSave();
    applyDisplaySettings(preferences);
    setLanguage(preferences.language);
    closeSettings();
    setStatus(t("settingsSaved"));
    if (settingsStatusTimer !== undefined) window.clearTimeout(settingsStatusTimer);
    settingsStatusTimer = window.setTimeout(() => { setStatus(t("ready")); }, 1800);
  } catch {
    settingsSession.failSave();
    settingsStatus.textContent = translate(locale, "settingsSaveFailed");
    settingsStatus.className = "hint error";
    setSettingsBusy(false);
    settingsSave.focus();
  }
}
function updateSettingsDraft(): void { if (settingsSession.isOpen()) settingsSession.update(readSettingsControls()); }
function focusableSettingsElements(): HTMLElement[] {
  return Array.from(settingsPanel.querySelectorAll<HTMLElement>("button, select, input, [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
}

$("open-settings").addEventListener("click", openSettings);
settingsSave.addEventListener("click", () => { void saveSettings(); });
settingsCancel.addEventListener("click", cancelSettings);
for (const id of ["language", "theme", "window-mode", "text-size", "reduce-motion", "auto-scroll", "auto-update", "update-channel"]) $(id).addEventListener("change", updateSettingsDraft);
checkUpdates.addEventListener("click", async () => { try { renderUpdateState(await window.chatcomDesktop.checkForUpdates()); } catch (error) { showError(error); } });
restartUpdate.addEventListener("click", async () => { try { await window.chatcomDesktop.restartAndInstall(); } catch (error) { showError(error); } });
settingsPanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); cancelSettings(); return; }
  if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void saveSettings(); return; }
  if (event.key !== "Tab") return;
  const focusable = focusableSettingsElements();
  if (focusable.length === 0) { event.preventDefault(); settingsCard.focus(); return; }
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (event.key === "F11") {
    event.preventDefault();
    const nextMode: WindowMode = preferences?.windowMode === "fullscreen" ? "normal" : "fullscreen";
    if (settingsSession.isOpen()) { ($("window-mode") as HTMLSelectElement).value = nextMode; updateSettingsDraft(); }
    else void window.chatcomDesktop.updatePreferences({ windowMode: nextMode }).then((next) => { preferences = next; applyDisplaySettings(next); }).catch(showError);
  } else if (event.key === "Escape" && settingsPanel.hidden && preferences?.windowMode === "fullscreen") {
    void window.chatcomDesktop.updatePreferences({ windowMode: "normal" }).then((next) => { preferences = next; applyDisplaySettings(next); }).catch(showError);
  }
});
$("choose-project").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.chooseProject(); if (!result.canceled && result.projectRoot) { projectRoot.value = result.projectRoot; preflight = undefined; configurationStatus.textContent = t("projectSelected"); configurationStatus.className = "hint"; } } catch (error) { showError(error); } });
$("verify-config").addEventListener("click", async () => { try { renderPreflight(await window.chatcomDesktop.preflight()); if (snapshot) renderSnapshot(snapshot); setStatus(t("preflight")); } catch (error) { showError(error); } });
$("start").addEventListener("click", async () => { const firstError = validateForm(); if (firstError) { firstError.focus(); setStatus(t("accessibilityRequired")); return; } try { const configured = await window.chatcomDesktop.configure({ projectRoot: projectRoot.value, phase: phase.value, point: point.value, mission: mission.value, maxCycles: Number(maxCycles.value), cycleTimeoutMs: Number(cycleTimeout.value), globalTimeoutMs: Number(globalTimeout.value) }); renderSnapshot(configured); timeline.replaceChildren(); await window.chatcomDesktop.start(); setStatus(t("started")); } catch (error) { showError(error); } });
$("pause").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.pause()); setStatus(t("paused")); } catch (error) { showError(error); } });
$("resume").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.resume()); setStatus(t("resumed")); } catch (error) { showError(error); } });
$("stop").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.stop()); setStatus(t("stopped")); } catch (error) { showError(error); } });
$("submit-decision").addEventListener("click", async () => { try { if (decisionResponse.value.trim().length === 0) throw new Error("CHATCOM_DESKTOP kind=FAILURE code=DECISION_RESPONSE_INVALID"); renderSnapshot(await window.chatcomDesktop.submitDecision(decisionResponse.value)); decisionResponse.value = ""; setStatus(t("decisionSaved")); } catch (error) { showError(error); } });
$("copy-diagnostic").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.copyDiagnostic(); setStatus(result.copied ? t("diagnosticCopied") : t("noDiagnostic")); } catch (error) { showError(error); } });
$("export-report").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.exportReport(); setStatus(result.canceled ? t("exportCanceled") : t("exported")); } catch (error) { showError(error); } });
$("reset-preferences").addEventListener("click", async () => { if (!window.confirm(t("resetConfirm"))) return; try { await window.chatcomDesktop.resetPreferences(); const state = await window.chatcomDesktop.getState(); preferences = state.preferences; setLanguage(preferences.language); applyDisplaySettings(preferences); setSettingsControls(preferences); setStatus(t("resetDone")); } catch (error) { showError(error); } });
mission.addEventListener("input", updateMissionCount);
window.chatcomDesktop.onEvent(handleEvent);
window.chatcomDesktop.onUpdate(renderUpdateState);
void window.chatcomDesktop.getUpdateState().then(renderUpdateState).catch(showError);
void window.chatcomDesktop.getState().then((state) => { preferences = state.preferences; locale = preferences.language; setLanguage(locale); applyDisplaySettings(preferences); projectRoot.value = preferences.projectRoot ?? ""; phase.value = preferences.phase ?? ""; point.value = preferences.point ?? ""; maxCycles.value = String(preferences.maxCycles); setSettingsControls(preferences); renderPreflight(state.preflight); renderSnapshot(state.snapshot); }).catch(showError);
setLanguage(locale); updateMissionCount(); setStatus(t("ready")); setInterval(() => { if (snapshot) renderSnapshot(snapshot); }, 1000);
