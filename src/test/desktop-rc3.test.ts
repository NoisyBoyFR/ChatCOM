import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DICTIONARIES, SUPPORTED_LOCALES, detectLocale, isSupportedLocale, normalizeLocale } from "../desktop/i18n.js";
import { DEFAULT_PREFERENCES, PREFERENCES_SCHEMA_VERSION, migratePreferences, parsePreferences } from "../desktop/preferences.js";

test("RC.3 i18n dictionaries have identical non-empty keys", () => {
  const keys = Object.keys(DICTIONARIES["fr-FR"]).sort();
  assert.equal(SUPPORTED_LOCALES.length, 4);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(DICTIONARIES[locale]).sort(), keys);
    assert.ok(Object.values(DICTIONARIES[locale]).every((value) => value.trim().length > 0));
  }
});

test("RC.3 locale detection supports the four locales and safe fallback", () => {
  assert.equal(normalizeLocale("fr"), "fr-FR");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(detectLocale("de-DE"), "fr-FR");
  assert.equal(detectLocale(undefined), "fr-FR");
  assert.equal(isSupportedLocale("ru-RU"), true);
  assert.equal(isSupportedLocale("de-DE"), false);
});

test("RC.3 preferences migrate RC.2, reject invalid values and preserve only safe fields", () => {
  const migrated = migratePreferences({ projectRoot: "C:\\Project", phase: "TESTS", point: "UI", maxCycles: 3, mission: "must-not-persist", token: "secret", theme: "dark", windowMode: "fullscreen", language: "en-US" });
  assert.equal(migrated.schemaVersion, PREFERENCES_SCHEMA_VERSION);
  assert.equal(migrated.language, "en-US");
  assert.equal(migrated.theme, "dark");
  assert.equal(migrated.windowMode, "fullscreen");
  assert.equal("mission" in migrated, false);
  assert.equal("token" in migrated, false);
  assert.equal(parsePreferences({ maxCycles: 99, theme: "invalid", windowMode: "invalid", textSize: "invalid" }).maxCycles, DEFAULT_PREFERENCES.maxCycles);
});

test("RC.3 renderer keeps visible copy in dictionaries", async () => {
  const source = await readFile("apps/desktop/renderer/renderer.ts", "utf8");
  assert.doesNotMatch(source, /Choisir le projet|Projet supervisé|Démarrer|Настройки|设置/u);
  assert.match(source, /translate\(locale/u);
});

test("RC.3 window and preference controls stay behind typed IPC", async () => {
  const source = await readFile("apps/desktop/main/main.ts", "utf8");
  assert.match(source, /DESKTOP_IPC_CHANNELS\.updatePreferences/u);
  assert.match(source, /setFullScreen/u);
  assert.match(source, /migratePreferences/u);
});

test("RC.3 renderer covers display settings and keyboard escape paths", async () => {
  const html = await readFile("apps/desktop/renderer/index.html", "utf8");
  const renderer = await readFile("apps/desktop/renderer/renderer.ts", "utf8");
  assert.match(html, /id="settings-panel"/u);
  for (const id of ["language", "theme", "window-mode", "text-size", "reduce-motion", "auto-scroll"]) assert.match(html, new RegExp(`id="${id}"`, "u"));
  assert.match(renderer, /key === "F11"/u);
  assert.match(renderer, /key === "Escape"/u);
  assert.match(renderer, /prefers-reduced-motion|reduceMotion/u);
});

test("RC.3 artifact naming and manifest are constrained", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const verifier = await readFile("scripts/verify-desktop-package.mjs", "utf8");
  assert.match(workflow, /chatcom-desktop-1\.0\.0-rc\.3-windows-x64/u);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/u);
  for (const key of ["version", "platform", "architecture", "filename", "size", "sha256", "codexRuntimeVersion", "signature"]) assert.match(verifier, new RegExp(`${key}`, "u"));
  assert.match(verifier, /UNSIGNED/u);
});
