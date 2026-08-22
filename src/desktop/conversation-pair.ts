import { rename, writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface PersistedConversationPair {
  version: 1;
  workThreadId: string;
  codexThreadId: string;
  workProjectRoot: string;
  codexProjectRoot: string;
  workTitle: string;
  codexTitle: string;
  firstSpeaker: "WORK" | "CODEX";
  objective: string;
  maxCycles: number;
  phase: string;
  point: string;
  cycleTimeoutMs: number;
}

export interface ConversationPairSummary {
  workTitle: string; codexTitle: string; workProjectRoot: string; codexProjectRoot: string;
  workThreadTail: string; codexThreadTail: string; firstSpeaker: "WORK" | "CODEX"; objective: string; maxCycles: number;
}

export function summarizeConversationPair(pair: PersistedConversationPair): ConversationPairSummary {
  return { workTitle: pair.workTitle, codexTitle: pair.codexTitle, workProjectRoot: pair.workProjectRoot, codexProjectRoot: pair.codexProjectRoot, workThreadTail: `…${pair.workThreadId.slice(-6)}`, codexThreadTail: `…${pair.codexThreadId.slice(-6)}`, firstSpeaker: pair.firstSpeaker, objective: pair.objective, maxCycles: pair.maxCycles };
}

export class ConversationPairStore {
  constructor(private readonly path: string) {}

  async read(): Promise<PersistedConversationPair | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) return undefined;
      const value = parsed as Partial<PersistedConversationPair>;
      if (typeof value.workThreadId !== "string" || typeof value.codexThreadId !== "string" || typeof value.workProjectRoot !== "string" || typeof value.codexProjectRoot !== "string" || typeof value.phase !== "string" || typeof value.point !== "string" || typeof value.cycleTimeoutMs !== "number") return undefined;
      return value as PersistedConversationPair;
    } catch { return undefined; }
  }

  async write(pair: PersistedConversationPair): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(pair, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    try { await unlink(this.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
