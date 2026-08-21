import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../apps/desktop/main/main.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../apps/desktop/preload/preload.ts", import.meta.url), "utf8");
const renderer = await readFile(new URL("../apps/desktop/renderer/renderer.ts", import.meta.url), "utf8");
const html = await readFile(new URL("../apps/desktop/renderer/index.html", import.meta.url), "utf8");

test("Electron window and preload keep renderer capabilities bounded", () => {
  assert.match(main, /nodeIntegration:\s*false/u);
  assert.match(main, /contextIsolation:\s*true/u);
  assert.match(main, /sandbox:\s*true/u);
  assert.match(main, /webSecurity:\s*true/u);
  assert.match(main, /setPermissionRequestHandler/u);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/u);
  assert.match(main, /runDesktopPreflight/u);
  assert.match(main, /PREFLIGHT_REQUIRED/u);
  assert.match(preload, /contextBridge\.exposeInMainWorld/u);
  assert.doesNotMatch(preload, /shell\s*:/u);
  assert.doesNotMatch(renderer, /from ["']electron/u);
  assert.doesNotMatch(renderer, /\beval\s*\(/u);
  assert.doesNotMatch(renderer, /new Function\s*\(/u);
});

test("renderer exposes the supervised flow and restrictive CSP", () => {
  for (const id of ["choose-project", "start", "pause", "resume", "stop", "copy-diagnostic", "export-report", "verify-config", "decision-panel", "decision-response", "submit-decision", "timeline"]) assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  assert.match(html, /data-i18n=["']subtitle["']/u);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /connect-src 'none'/u);
  assert.match(html, /object-src 'none'/u);
});
