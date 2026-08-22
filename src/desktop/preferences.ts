import { detectLocale, isSupportedLocale, type Locale } from "./i18n.js";

export const PREFERENCES_SCHEMA_VERSION = 3 as const;
export type Theme = "system" | "light" | "dark";
export type WindowMode = "normal" | "maximized" | "fullscreen";
export type TextSize = "small" | "normal" | "large";
export type UpdateChannel = "stable" | "preview";

export interface DesktopPreferences {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION;
  language: Locale;
  theme: Theme;
  windowMode: WindowMode;
  textSize: TextSize;
  reduceMotion: boolean;
  autoScroll: boolean;
  autoUpdateEnabled: boolean;
  updateChannel: UpdateChannel;
  projectRoot?: string;
  phase?: string;
  point?: string;
  maxCycles: number;
}

export const DEFAULT_PREFERENCES: DesktopPreferences = { schemaVersion: PREFERENCES_SCHEMA_VERSION, language: "fr-FR", theme: "system", windowMode: "normal", textSize: "normal", reduceMotion: false, autoScroll: true, autoUpdateEnabled: true, updateChannel: "preview", maxCycles: 5 };
export function defaultUpdateChannel(version: string): UpdateChannel { return version.includes("-") ? "preview" : "stable"; }

function boundedText(value: unknown, max = 512): string | undefined { return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : undefined; }
function boundedCycles(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 20 ? value : DEFAULT_PREFERENCES.maxCycles; }

export function parsePreferences(raw: unknown, systemLocale?: string, appVersion = "1.0.0-rc.7"): DesktopPreferences {
  const value = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const language = isSupportedLocale(value.language) ? value.language : detectLocale(systemLocale);
  const result: DesktopPreferences = {
    ...DEFAULT_PREFERENCES,
    language,
    theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : DEFAULT_PREFERENCES.theme,
    windowMode: value.windowMode === "maximized" || value.windowMode === "fullscreen" || value.windowMode === "normal" ? value.windowMode : DEFAULT_PREFERENCES.windowMode,
    textSize: value.textSize === "small" || value.textSize === "large" || value.textSize === "normal" ? value.textSize : DEFAULT_PREFERENCES.textSize,
    reduceMotion: typeof value.reduceMotion === "boolean" ? value.reduceMotion : DEFAULT_PREFERENCES.reduceMotion,
    autoScroll: typeof value.autoScroll === "boolean" ? value.autoScroll : DEFAULT_PREFERENCES.autoScroll,
    autoUpdateEnabled: typeof value.autoUpdateEnabled === "boolean" ? value.autoUpdateEnabled : DEFAULT_PREFERENCES.autoUpdateEnabled,
    updateChannel: value.updateChannel === "stable" || value.updateChannel === "preview" ? value.updateChannel : defaultUpdateChannel(appVersion),
    maxCycles: boundedCycles(value.maxCycles),
  };
  const projectRoot = boundedText(value.projectRoot, 4_096); if (projectRoot) result.projectRoot = projectRoot;
  const phase = boundedText(value.phase); if (phase) result.phase = phase;
  const point = boundedText(value.point); if (point) result.point = point;
  return result;
}

export function migratePreferences(raw: unknown, systemLocale?: string, appVersion = "1.0.0-rc.7"): DesktopPreferences { return parsePreferences(raw, systemLocale, appVersion); }
export function preferencesForStorage(preferences: DesktopPreferences): DesktopPreferences { return parsePreferences(preferences, preferences.language); }
