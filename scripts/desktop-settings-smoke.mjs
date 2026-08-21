import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.env.CHATCOM_DESKTOP_EXE;
if (!executable) throw new Error("CHATCOM_DESKTOP_EXE is required");

const port = 9237;
const userData = await mkdtemp(join(tmpdir(), "chatcom-settings-userdata-"));
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
  const url = await endpoint();
  socket = new WebSocket(url);
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
  return socket;
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("ELECTRON_EVALUATION_FAILED");
  return result.result?.value;
}

async function click(selector) {
  const box = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error("missing"); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  console.log(`CHATCOM_DESKTOP_SMOKE click=${selector} x=${box.x} y=${box.y}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
}

async function setSelect(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event("change", { bubbles: true })); return element.value; })()`);
}

async function waitFor(expression, expected = true) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate(expression) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ELECTRON_ASSERTION_TIMEOUT");
}

async function launch() {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    env: childEnv,
    windowsHide: true,
    stdio: "ignore",
  });
  childExited = false;
  child.once("exit", () => { childExited = true; });
  await connect();
  await waitFor("document.readyState", "complete");
}

async function stop() {
  try {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: nextId++, method: "Browser.close", params: {} }));
    }
  } catch { /* the browser may already be closed. */ }
  if (socket) socket.close();
  if (child && !childExited) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!childExited) child.kill();
    for (let attempt = 0; attempt < 20 && !childExited; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function removeUserData() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(userData, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("ELECTRON_SMOKE_CLEANUP_FAILED");
}

try {
  await launch();
  await click("#open-settings");
  console.log("CHATCOM_DESKTOP_SMOKE state=" + JSON.stringify(await evaluate("({ hidden: document.querySelector('#settings-panel')?.hidden, active: document.activeElement?.id, target: document.elementFromPoint(1096, 73)?.id, ready: document.readyState })")));
  await waitFor("!document.querySelector('#settings-panel').hidden");
  await setSelect("#theme", "dark");
  await click("#cancel-settings");
  await waitFor("document.querySelector('#settings-panel').hidden");
  await click("#open-settings");
  await waitFor("document.querySelector('#theme').value", "system");
  await click("#cancel-settings");
  await click("#open-settings");
  await setSelect("#theme", "dark");
  await click("#save-settings");
  await waitFor("document.querySelector('#settings-panel').hidden");
  await waitFor("document.documentElement.dataset.theme", "dark");
  await evaluate("document.querySelector('#open-settings').focus()");
  await click("#open-settings");
  await setSelect("#text-size", "large");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await waitFor("document.querySelector('#settings-panel').hidden");
  await click("#open-settings");
  await waitFor("document.querySelector('#text-size').value", "normal");
  await click("#cancel-settings");
  await stop();
  await launch();
  await click("#open-settings");
  await waitFor("document.querySelector('#theme').value", "dark");
  await waitFor("document.documentElement.dataset.theme", "dark");
  await click("#cancel-settings");
  console.log("CHATCOM_DESKTOP_SETTINGS_SMOKE kind=SUCCESS save=CONFIRMED cancel=CONFIRMED keyboard=CONFIRMED restart=CONFIRMED");
} finally {
  await stop();
  await removeUserData();
}
