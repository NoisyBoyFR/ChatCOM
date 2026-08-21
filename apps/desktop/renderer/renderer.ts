import type { ConversationEvent, ConversationSnapshot } from "../../../src/conversation/orchestrator.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const projectRoot = $("project-root") as HTMLInputElement;
const phase = $("phase") as HTMLInputElement;
const point = $("point") as HTMLInputElement;
const mission = $("mission") as HTMLTextAreaElement;
const maxCycles = $("max-cycles") as HTMLInputElement;
const cycleTimeout = $("cycle-timeout") as HTMLInputElement;
const stateBadge = $("state-badge");
const configurationStatus = $("configuration-status");
const footerStatus = $("footer-status");
const timeline = $("timeline");
let snapshot: ConversationSnapshot | undefined;

function setStatus(text: string): void {
  footerStatus.textContent = text;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "CHATCOM_DESKTOP kind=FAILURE code=REQUEST_FAILED";
  const safe = /^CHATCOM_DESKTOP kind=FAILURE code=[A-Z0-9_]+$/u.test(message) ? message : "CHATCOM_DESKTOP kind=FAILURE code=REQUEST_FAILED";
  configurationStatus.textContent = safe;
  configurationStatus.className = "hint error";
  setStatus("Une intervention est nécessaire.");
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
  $("start").toggleAttribute("disabled", running || !["READY", "PAUSED"].includes(next.state));
  $("pause").toggleAttribute("disabled", next.state !== "RUNNING");
  $("resume").toggleAttribute("disabled", next.state !== "PAUSED");
  $("stop").toggleAttribute("disabled", !running && !["READY", "PAUSED"].includes(next.state));
  if (next.state === "USER_DECISION_REQUIRED") configurationStatus.textContent = "Décision utilisateur requise : aucun cycle suivant ne démarre automatiquement.";
}

function renderTransmission(cycle: number, message: Extract<ConversationEvent, { kind: "transmission" }>['message']): void {
  const card = document.createElement("article");
  card.className = `message-card ${message.sender === "WORK_LOCAL" ? "work" : "codex"}`;
  const heading = document.createElement("div");
  heading.className = "message-heading";
  heading.textContent = `${message.sender} → ${message.recipient} · ${message.type} · cycle ${cycle}`;
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${message.created_at} · séquence ${message.sequence} · ${message.delivery_status}`;
  const content = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Afficher le contenu validé";
  const body = document.createElement("p");
  body.textContent = message.content;
  content.append(summary, body);
  card.append(heading, meta, content);
  timeline.append(card);
  timeline.scrollTop = timeline.scrollHeight;
}

function handleEvent(event: ConversationEvent): void {
  if (event.kind === "snapshot") renderSnapshot(event.snapshot);
  else if (event.kind === "transmission") renderTransmission(event.cycle, event.message);
  else if (event.kind === "cycle_started") setStatus(`Cycle ${event.cycle} démarré.`);
  else if (event.kind === "cycle_completed") setStatus(`Cycle ${event.cycle} terminé, nettoyage confirmé.`);
  else if (event.kind === "diagnostic") { setStatus(`Diagnostic borné : ${event.diagnostic.code}.`); configurationStatus.textContent = `Étape : ${event.diagnostic.relayStage ?? "—"} · transmissions : ${event.diagnostic.completedTransmissions} · nettoyage : ${event.diagnostic.cleanup}`; }
}

$("choose-project").addEventListener("click", async () => {
  try {
    const result = await window.chatcomDesktop.chooseProject();
    if (!result.canceled && result.projectRoot) { projectRoot.value = result.projectRoot; configurationStatus.textContent = "Projet sélectionné. Saisissez une mission puis démarrez."; configurationStatus.className = "hint"; }
  } catch (error) { showError(error); }
});

$("start").addEventListener("click", async () => {
  try {
    const configured = await window.chatcomDesktop.configure({ projectRoot: projectRoot.value, phase: phase.value, point: point.value, mission: mission.value, maxCycles: Number(maxCycles.value), cycleTimeoutMs: Number(cycleTimeout.value), globalTimeoutMs: 3_600_000 });
    renderSnapshot(configured);
    timeline.replaceChildren();
    await window.chatcomDesktop.start();
    setStatus("Relais démarré.");
  } catch (error) { showError(error); }
});

$("pause").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.pause()); setStatus("Pause demandée : le cycle courant se termine proprement."); } catch (error) { showError(error); } });
$("resume").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.resume()); setStatus("Reprise demandée."); } catch (error) { showError(error); } });
$("stop").addEventListener("click", async () => { try { renderSnapshot(await window.chatcomDesktop.stop()); setStatus("Arrêt et nettoyage terminés."); } catch (error) { showError(error); } });
$("copy-diagnostic").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.copyDiagnostic(); setStatus(result.copied ? "Diagnostic borné copié." : "Aucun diagnostic à copier."); } catch (error) { showError(error); } });
$("export-report").addEventListener("click", async () => { try { const result = await window.chatcomDesktop.exportReport(); setStatus(result.canceled ? "Export annulé." : `Compte rendu exporté : ${result.path}`); } catch (error) { showError(error); } });
$("reset-preferences").addEventListener("click", async () => { try { await window.chatcomDesktop.resetPreferences(); projectRoot.value = ""; setStatus("Préférences réinitialisées."); } catch (error) { showError(error); } });

window.chatcomDesktop.onEvent(handleEvent);
void window.chatcomDesktop.getState().then((state) => { projectRoot.value = state.preferences.projectRoot ?? ""; phase.value = state.preferences.phase ?? phase.value; point.value = state.preferences.point ?? point.value; maxCycles.value = String(state.preferences.maxCycles ?? maxCycles.value); renderSnapshot(state.snapshot); }).catch(showError);
setInterval(() => { if (snapshot) renderSnapshot(snapshot); }, 1000);
