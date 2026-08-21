import type { ConversationState } from "../conversation/orchestrator.js";

const STARTABLE_STATES = new Set<ConversationState>(["IDLE", "READY"]);

/** The Start action begins a configured conversation; PAUSED has Resume. */
export function isDesktopStartEnabled(state: ConversationState | undefined, preflightReady: boolean, busy = false): boolean {
  return !busy && preflightReady && state !== undefined && STARTABLE_STATES.has(state);
}

/** Guards the asynchronous configure → start sequence from double activation. */
export class DesktopStartCoordinator {
  private active = false;

  get busy(): boolean {
    return this.active;
  }

  async activate(action: () => Promise<void>): Promise<boolean> {
    if (this.active) return false;
    this.active = true;
    try {
      await action();
      return true;
    } catch (error) {
      this.active = false;
      throw error;
    }
  }

  release(): void {
    this.active = false;
  }
}
