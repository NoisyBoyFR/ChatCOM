import type { DesktopPreferences } from "./preferences.js";

export type EditablePreferences = Pick<DesktopPreferences, "language" | "theme" | "windowMode" | "textSize" | "reduceMotion" | "autoScroll" | "autoUpdateEnabled" | "updateChannel">;

function editable(preferences: DesktopPreferences): EditablePreferences {
  return {
    language: preferences.language,
    theme: preferences.theme,
    windowMode: preferences.windowMode,
    textSize: preferences.textSize,
    reduceMotion: preferences.reduceMotion,
    autoScroll: preferences.autoScroll,
    autoUpdateEnabled: preferences.autoUpdateEnabled,
    updateChannel: preferences.updateChannel,
  };
}

export class SettingsSession {
  private draftState: EditablePreferences | undefined;
  private saving = false;

  open(preferences: DesktopPreferences): EditablePreferences {
    this.draftState = editable(preferences);
    this.saving = false;
    return this.snapshot();
  }

  snapshot(): EditablePreferences {
    if (!this.draftState) throw new Error("SETTINGS_SESSION_CLOSED");
    return { ...this.draftState };
  }

  update(patch: Partial<EditablePreferences>): boolean {
    if (!this.draftState || this.saving) return false;
    this.draftState = { ...this.draftState, ...patch };
    return true;
  }

  beginSave(): boolean {
    if (!this.draftState || this.saving) return false;
    this.saving = true;
    return true;
  }

  failSave(): void {
    if (this.draftState) this.saving = false;
  }

  completeSave(): EditablePreferences {
    const saved = this.snapshot();
    this.draftState = undefined;
    this.saving = false;
    return saved;
  }

  cancel(): boolean {
    if (this.saving) return false;
    this.draftState = undefined;
    return true;
  }

  isOpen(): boolean { return this.draftState !== undefined; }
  isSaving(): boolean { return this.saving; }
}
