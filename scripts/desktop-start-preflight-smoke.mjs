import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const executable = process.env.CHATCOM_DESKTOP_EXE;
if (!executable) throw new Error("CHATCOM_DESKTOP_EXE is required");

const port = 9238;
const userData = await mkdtemp(join(tmpdir(), "chatcom-start-userdata-"));
const projectRoot = await mkdtemp(join(tmpdir(), "chatcom-start-project-"));
await mkdir(join(projectRoot, ".git"));
await writeFile(join(userData, "preferences.json"), JSON.stringify({ schemaVersion: 2, projectRoot, phase: "TEST_UTILISATEUR", point: "COMMUNICATION_WORK_CODEX", maxCycles: 1 }, null, 2));

let child;
let socket;
let nextId = 1;
const pending = new Map();
let childExited = true;

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("ELECTRON_EVALUATION_FAILED");
  return result.result?.value;
}

async function endpoint() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((candidate) => candidate.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* Electron is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ELECTRON_PAGE_NOT_FOUND");
}

async function connect() {
  socket = new WebSocket(await endpoint());
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  await send("Runtime.enable");
}

async function waitFor(expression, expected = true) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ELECTRON_ASSERTION_TIMEOUT");
}

async function setValue(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error("missing"); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return element.value; })()`);
}

async function launch() {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { env: childEnv, windowsHide: true, stdio: "ignore" });
  childExited = false;
  child.once("exit", () => { childExited = true; });
  await connect();
  await waitFor("document.readyState", "complete");
}

async function stop() {
  try {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: nextId++, method: "Browser.close", params: {} }));
  } catch { /* the browser may already be closed. */ }
  if (socket) socket.close();
  if (child && !childExited) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!childExited) child.kill();
    for (let attempt = 0; attempt < 20 && !childExited; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await launch();
  await setValue("#phase", "TEST_UTILISATEUR");
  await setValue("#point", "COMMUNICATION_WORK_CODEX");
  await setValue("#mission", "Inspecte le dépôt ChatCOM en lecture seule. WORK doit transmettre cette mission à Codex, Codex doit retourner à WORK un rapport technique concis sur l’état du projet, puis WORK doit préparer le prochain prompt. Ne modifie aucun fichier, aucune configuration et aucun historique Git.");
  await setValue("#max-cycles", "1");
  await setValue("#cycle-timeout", "600000");
  await setValue("#global-timeout", "900000");
  await evaluate("document.querySelector('#verify-config').click(); true");
  await waitFor("document.querySelector('#runtime-status').textContent === 'READY' && document.querySelector('#auth-status').textContent === 'READY' && document.querySelector('#project-status').textContent === 'READY' && document.querySelector('#security-status').textContent === 'READ_ONLY'");
  const result = await evaluate("({ state: document.querySelector('#state-badge').textContent, startDisabled: document.querySelector('#start').disabled, runtime: document.querySelector('#runtime-status').textContent, authentication: document.querySelector('#auth-status').textContent, project: document.querySelector('#project-status').textContent, security: document.querySelector('#security-status').textContent })");
  if (result.state !== "IDLE" || result.startDisabled !== false) throw new Error("START_NOT_ENABLED_FROM_IDLE");
  console.log(`CHATCOM_DESKTOP_START_PREFLIGHT_SMOKE kind=SUCCESS state=${result.state} start=ENABLED runtime=${result.runtime} authentication=${result.authentication} project=${result.project} security=${result.security} relay=NOT_STARTED`);
} finally {
  await stop();
  await rm(userData, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
}
