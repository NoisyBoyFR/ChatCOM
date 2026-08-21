import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";
import { detectLocale, isSupportedLocale, translate, type I18nKey, type Locale } from "../../../src/desktop/i18n.js";
import type { DesktopPreferences, Theme, TextSize, WindowMode } from "../../../src/desktop/preferences.js";

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
let snapshot: ConversationSnapshot | undefined;
let preferences: DesktopPreferences | undefined;
let preflight: import("../../../src/desktop/preflight.js").PreflightResult | undefined;
let locale: Locale = detectLocale(navigator.language);

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
async function saveSettings(input: Partial<Pick<DesktopPreferences, "language" | "theme" | "windowMode" | "textSize" | "reduceMotion" | "autoScroll">>): Promise<void> {
  preferences = await window.chatcomDesktop.updatePreferences(input); applyDisplaySettings(preferences); setLanguage(preferences.language); settingsStatus.textContent = t("settingsSaved");
}

$("open-settings").addEventListener("click", () => { settingsPanel.hidden = false; });
$("close-settings").addEventListener("click", () => { settingsPanel.hidden = true; });
$("language").addEventListener("change", () => { const value = ($("language") as HTMLSelectElement).value; if (isSupportedLocale(value)) void saveSettings({ language: value }); });
$("theme").addEventListener("change", () => void saveSettings({ theme: ($("theme") as HTMLSelectElement).value as Theme }));
$("window-mode").addEventListener("change", () => void saveSettings({ windowMode: ($("window-mode") as HTMLSelectElement).value as WindowMode }));
$("text-size").addEventListener("change", () => void saveSettings({ textSize: ($("text-size") as HTMLSelectElement).value as TextSize }));
$("reduce-motion").addEventListener("change", () => void saveSettings({ reduceMotion: ($("reduce-motion") as HTMLInputElement).checked }));
$("auto-scroll").addEventListener("change", () => void saveSettings({ autoScroll: ($("auto-scroll") as HTMLInputElement).checked }));
document.addEventListener("keydown", (event) => { if (event.key === "F11") { event.preventDefault(); void saveSettings({ windowMode: preferences?.windowMode === "fullscreen" ? "normal" : "fullscreen" }); } else if (event.key === "Escape" && preferences?.windowMode === "fullscreen") void saveSettings({ windowMode: "normal" }); });
$("choose-project").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.chooseProject(); if (!result.canceled && result.projectRoot) { projectRoot.value = result.projectRoot; preflight = undefined; configurationStatus.textContent = t("projectSelected"); configurationStatus.className = "hint"; } } catch (error) { showError(error); } });
$("verify-config").addEventListener("click", async () => { try { renderPreflight(await window.chatcomDesktop.preflight()); if (snapshot) renderSnapshot(snapshot); setStatus(t("preflight")); } catch (error) { showError(error); } });
$("start").addEventListener("click", async () => { const firstError = validateForm(); if (firstError) { firstError.focus(); setStatus(t("accessibilityRequired")); return; } try { const configured = await window.chatcomDesktop.configure({ projectRoot: projectRoot.value, phase: phase.value, point: point.value, mission: mission.value, maxCycles: Number(maxCycles.value), cycleTimeoutMs: Number(cycleTimeout.value), globalTimeoutMs: Number(globalTimeout.value) }); renderSnapshot(configured); timeline.replaceChildren(); await window.chatcomDesktop.start(); setStatus(t("started")); } catch (error) { showError(error); } });
$("pause").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.pause()); setStatus(t("paused")); } catch (error) { showError(error); } });
$("resume").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.resume()); setStatus(t("resumed")); } catch (error) { showError(error); } });
$("stop").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.stop()); setStatus(t("stopped")); } catch (error) { showError(error); } });
$("submit-decision").addEventListener("click", async () => { try { if (decisionResponse.value.trim().length === 0) throw new Error("CHATCOM_DESKTOP kind=FAILURE code=DECISION_RESPONSE_INVALID"); renderSnapshot(await window.chatcomDesktop.submitDecision(decisionResponse.value)); decisionResponse.value = ""; setStatus(t("decisionSaved")); } catch (error) { showError(error); } });
$("copy-diagnostic").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.copyDiagnostic(); setStatus(result.copied ? t("diagnosticCopied") : t("noDiagnostic")); } catch (error) { showError(error); } });
$("export-report").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.exportReport(); setStatus(result.canceled ? t("exportCanceled") : t("exported")); } catch (error) { showError(error); } });
$("reset-preferences").addEventListener("click", async () => { if (!window.confirm(t("resetConfirm"))) return; try { await window.chatcomDesktop.resetPreferences(); const state = await window.chatcomDesktop.getState(); preferences = state.preferences; setLanguage(preferences.language); applyDisplaySettings(preferences); ($("language") as HTMLSelectElement).value = preferences.language; ($("theme") as HTMLSelectElement).value = preferences.theme; ($("window-mode") as HTMLSelectElement).value = preferences.windowMode; ($("text-size") as HTMLSelectElement).value = preferences.textSize; ($("reduce-motion") as HTMLInputElement).checked = preferences.reduceMotion; ($("auto-scroll") as HTMLInputElement).checked = preferences.autoScroll; setStatus(t("resetDone")); } catch (error) { showError(error); } });
mission.addEventListener("input", updateMissionCount);
window.chatcomDesktop.onEvent(handleEvent);
void window.chatcomDesktop.getState().then((state) => { preferences = state.preferences; locale = preferences.language; setLanguage(locale); applyDisplaySettings(preferences); projectRoot.value = preferences.projectRoot ?? ""; phase.value = preferences.phase ?? ""; point.value = preferences.point ?? ""; maxCycles.value = String(preferences.maxCycles); ($("language") as HTMLSelectElement).value = preferences.language; ($("theme") as HTMLSelectElement).value = preferences.theme; ($("window-mode") as HTMLSelectElement).value = preferences.windowMode; ($("text-size") as HTMLSelectElement).value = preferences.textSize; ($("reduce-motion") as HTMLInputElement).checked = preferences.reduceMotion; ($("auto-scroll") as HTMLInputElement).checked = preferences.autoScroll; renderPreflight(state.preflight); renderSnapshot(state.snapshot); }).catch(showError);
setLanguage(locale); updateMissionCount(); setStatus(t("ready")); setInterval(() => { if (snapshot) renderSnapshot(snapshot); }, 1000);
