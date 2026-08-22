import { randomUUID } from "node:crypto";
import { AppServerClient, type AppServerThreadSummary } from "../app-server-client.js";
import { resolveBundledCodexRuntime } from "../codex-sdk-relay.js";

export const CODEX_CONVERSATION_SOURCES = ["cli", "vscode", "exec", "appServer", "unknown"] as const;
export type CodexConversationSource = (typeof CODEX_CONVERSATION_SOURCES)[number];

export interface ConversationCard {
  handle: string;
  title: string;
  projectRoot: string;
  lastActivity: string;
  state: "LOADED" | "AVAILABLE" | "UNAVAILABLE";
  available: boolean;
  provider: string;
  source: CodexConversationSource;
  idTail: string;
}

export interface ConversationCatalogClient {
  initialize(): Promise<void>;
  listAllThreads(options?: { cwd?: string; searchTerm?: string; sourceKinds?: readonly string[] }): Promise<AppServerThreadSummary[]>;
  listLoadedThreads(): Promise<string[]>;
  close(): Promise<{ exited: boolean; forced: boolean }>;
}

export interface ConversationCatalogDependencies {
  createClient(): Promise<ConversationCatalogClient>;
  randomUUID(): string;
}

const DEFAULT_DEPENDENCIES: ConversationCatalogDependencies = {
  createClient: async () => {
    const runtime = await resolveBundledCodexRuntime();
    return AppServerClient.spawn({ requestMs: 30_000, turnMs: 30_000 }, runtime);
  },
  randomUUID,
};

function maskedTail(id: string): string { return `…${id.slice(-6)}`; }

function cardFromThread(thread: AppServerThreadSummary, loaded: ReadonlySet<string>, handle: string): ConversationCard {
  const sourceValue = thread.sourceKind ?? thread.source ?? "unknown";
  const source = (CODEX_CONVERSATION_SOURCES as readonly string[]).includes(sourceValue) ? sourceValue as CodexConversationSource : "unknown";
  const available = thread.status !== "systemError";
  const timestamp = thread.updatedAt ?? thread.createdAt;
  return {
    handle,
    title: (thread.title ?? thread.preview ?? "Untitled conversation").trim() || "Untitled conversation",
    projectRoot: thread.cwd ?? "UNKNOWN",
    lastActivity: typeof timestamp === "number" ? new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000).toISOString() : "UNKNOWN",
    state: available ? loaded.has(thread.id) ? "LOADED" : "AVAILABLE" : "UNAVAILABLE",
    available,
    provider: "Codex",
    source,
    idTail: maskedTail(thread.id),
  };
}

export class ConversationCatalog {
  private readonly handles = new Map<string, { id: string; card: ConversationCard }>();

  constructor(private readonly dependencies: ConversationCatalogDependencies = DEFAULT_DEPENDENCIES) {}

  async discover(options: { projectRoot?: string; searchTerm?: string } = {}): Promise<ConversationCard[]> {
    const client = await this.dependencies.createClient();
    try {
      await client.initialize();
      const [threads, loadedIds] = await Promise.all([
        client.listAllThreads({ cwd: options.projectRoot, searchTerm: options.searchTerm, sourceKinds: CODEX_CONVERSATION_SOURCES }),
        client.listLoadedThreads(),
      ]);
      this.handles.clear();
      const loaded = new Set(loadedIds);
      return threads.map((thread) => {
        const handle = this.dependencies.randomUUID();
        const card = cardFromThread(thread, loaded, handle);
        this.handles.set(handle, { id: thread.id, card });
        return card;
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  getSelected(handle: string): { id: string; card: ConversationCard } {
    const selected = this.handles.get(handle);
    if (!selected || !selected.card.available) throw new Error("CONVERSATION_UNAVAILABLE");
    return { id: selected.id, card: { ...selected.card } };
  }

  selectPair(workHandle: string, codexHandle: string): { work: ConversationCard; codex: ConversationCard } {
    if (workHandle === codexHandle) throw new Error("CONVERSATION_DUPLICATE");
    const work = this.getSelected(workHandle).card;
    const codex = this.getSelected(codexHandle).card;
    return { work, codex };
  }

  clear(): void { this.handles.clear(); }
}

export function createAppServerConversationClient(): Promise<AppServerClient> {
  return DEFAULT_DEPENDENCIES.createClient() as Promise<AppServerClient>;
}
