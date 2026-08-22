import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { translate, type Locale } from "../desktop/i18n.js";
import { DEFAULT_PREFERENCES, parsePreferences, preferencesForStorage } from "../desktop/preferences.js";
import { SettingsSession } from "../desktop/settings-session.js";

test("settings session opens repeatedly, cancels without persistence, and restores the saved snapshot", () => {
  const session = new SettingsSession();
  const first = session.open(DEFAULT_PREFERENCES);
  assert.equal(first.theme, "system");
  assert.equal(session.update({ theme: "dark", windowMode: "fullscreen", textSize: "large" }), true);
  assert.equal(session.cancel(), true);
  assert.equal(session.isOpen(), false);
  assert.deepEqual(session.open(DEFAULT_PREFERENCES), {
    language: "fr-FR", theme: "system", windowMode: "normal", textSize: "normal", reduceMotion: false, autoScroll: true, autoUpdateEnabled: true, updateChannel: "preview",
  });
  session.update({ theme: "light", language: "en-US" });
  assert.equal(session.beginSave(), true);
  assert.equal(session.beginSave(), false);
  session.failSave();
  assert.equal(session.isOpen(), true);
  assert.equal(session.snapshot().theme, "light");
  assert.equal(session.beginSave(), true);
  assert.deepEqual(session.completeSave(), { language: "en-US", theme: "light", windowMode: "normal", textSize: "normal", reduceMotion: false, autoScroll: true, autoUpdateEnabled: true, updateChannel: "preview" });
  assert.equal(session.isOpen(), false);
});

test("settings translations are exact in all four locales", () => {
  const expected: Record<Locale, [string, string, string]> = {
    "fr-FR": ["Sauvegarder", "Annuler", "Paramètres enregistrés."],
    "en-US": ["Save", "Cancel", "Settings saved."],
    "zh-CN": ["保存", "取消", "设置已保存。"],
    "ru-RU": ["Сохранить", "Отмена", "Настройки сохранены."],
  };
  for (const [locale, values] of Object.entries(expected) as Array<[Locale, [string, string, string]]>) {
    assert.equal(translate(locale, "settingsSave"), values[0]);
    assert.equal(translate(locale, "settingsCancel"), values[1]);
    assert.equal(translate(locale, "settingsSaved"), values[2]);
  }
});

test("settings renderer uses one explicit save/cancel path with keyboard focus management", async () => {
  const html = await readFile("apps/desktop/renderer/index.html", "utf8");
  const renderer = await readFile("apps/desktop/renderer/renderer.ts", "utf8");
  assert.match(html, /role="dialog" aria-modal="true"/u);
  assert.match(html, /id="save-settings"[^>]*data-i18n="settingsSave"/u);
  assert.match(html, /id="cancel-settings"[^>]*data-i18n="settingsCancel"/u);
  assert.doesNotMatch(html, /id="close-settings"/u);
  assert.equal((renderer.match(/settingsSave\.addEventListener\(/gu) ?? []).length, 1);
  assert.equal((renderer.match(/settingsCancel\.addEventListener\(/gu) ?? []).length, 1);
  assert.match(renderer, /settingsSession\.beginSave\(\)/u);
  assert.match(renderer, /settingsSession\.failSave\(\)/u);
  assert.match(renderer, /settingsSession\.cancel\(\)/u);
  assert.match(renderer, /event\.key === "Enter"/u);
  assert.match(renderer, /event\.key === "Escape"/u);
  assert.match(renderer, /trigger\.focus\(\)/u);
  assert.match(renderer, /setSettingsBusy\(true\)/u);
});

test("settings session covers display modes, motion and auto-scroll without applying a draft", () => {
  const session = new SettingsSession();
  session.open(DEFAULT_PREFERENCES);
  session.update({ theme: "dark", windowMode: "maximized", textSize: "small", reduceMotion: true, autoScroll: false });
  assert.deepEqual(session.snapshot(), { language: "fr-FR", theme: "dark", windowMode: "maximized", textSize: "small", reduceMotion: true, autoScroll: false, autoUpdateEnabled: true, updateChannel: "preview" });
  assert.equal(session.cancel(), true);
  assert.equal(session.isOpen(), false);
  assert.deepEqual(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, theme: "system", windowMode: "normal", textSize: "normal", reduceMotion: false, autoScroll: true });
});

test("saved settings survive a serialized preference restart", () => {
  assert.equal(parsePreferences(undefined, "fr-FR", "1.0.0").updateChannel, "stable");
  assert.equal(parsePreferences(undefined, "fr-FR", "1.0.0-rc.5").updateChannel, "preview");
  const saved = preferencesForStorage({ ...DEFAULT_PREFERENCES, language: "ru-RU", theme: "dark", windowMode: "maximized", textSize: "large", reduceMotion: true, autoScroll: false });
  const restored = parsePreferences(JSON.parse(JSON.stringify(saved)), "fr-FR");
  assert.equal(restored.language, "ru-RU");
  assert.equal(restored.theme, "dark");
  assert.equal(restored.windowMode, "maximized");
  assert.equal(restored.textSize, "large");
  assert.equal(restored.reduceMotion, true);
  assert.equal(restored.autoScroll, false);
});

test("the packaged Electron smoke test sends real mouse and keyboard input", async () => {
  const smoke = await readFile("scripts/desktop-settings-smoke.mjs", "utf8");
  assert.match(smoke, /Input\.dispatchMouseEvent/u);
  assert.match(smoke, /Input\.dispatchKeyEvent/u);
  assert.match(smoke, /Browser\.close/u);
  assert.match(smoke, /restart=CONFIRMED/u);
});
