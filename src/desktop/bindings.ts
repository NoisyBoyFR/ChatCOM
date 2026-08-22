import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";

export const BINDING_REGISTRY_VERSION = 1 as const;
export type BindingMode = "PERSISTENT_BOUND";
export type BindingState = "VALID" | "DISABLED";

export interface CodexBinding {
  bindingId: string;
  alias: string;
  projectRoot: string;
  threadId: string;
  createdAt: string;
  mode: BindingMode;
  state: BindingState;
}

export interface BindingSummary {
  bindingId: string;
  alias: string;
  projectRoot: string;
  createdAt: string;
  mode: BindingMode;
  state: BindingState | "PROJECT_DIFFERENT" | "NOT_FOUND";
  threadTail: string;
}

interface RegistryFile { version: typeof BINDING_REGISTRY_VERSION; bindings: CodexBinding[]; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALIAS = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

function assertBindingId(value: string): void { if (!UUID.test(value)) throw new Error("BINDING_ID_INVALID"); }
function assertThreadId(value: string): void { if (!UUID.test(value)) throw new Error("BINDING_THREAD_ID_INVALID"); }
function assertAlias(value: string): void { if (!ALIAS.test(value.trim())) throw new Error("BINDING_ALIAS_INVALID"); }
function assertDate(value: string): void { if (new Date(value).toISOString() !== value) throw new Error("BINDING_DATE_INVALID"); }

function registryRecord(value: unknown): RegistryFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BINDING_REGISTRY_INVALID");
  const record = value as Record<string, unknown>;
  if (record.version !== BINDING_REGISTRY_VERSION || !Array.isArray(record.bindings)) throw new Error("BINDING_REGISTRY_INVALID");
  const bindings = record.bindings.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("BINDING_REGISTRY_INVALID");
    const item = raw as Record<string, unknown>;
    if (typeof item.bindingId !== "string" || typeof item.alias !== "string" || typeof item.projectRoot !== "string" || typeof item.threadId !== "string" || typeof item.createdAt !== "string" || item.mode !== "PERSISTENT_BOUND" || (item.state !== "VALID" && item.state !== "DISABLED")) throw new Error("BINDING_REGISTRY_INVALID");
    assertBindingId(item.bindingId); assertThreadId(item.threadId); assertAlias(item.alias); assertDate(item.createdAt);
    if (resolve(item.projectRoot) !== item.projectRoot) throw new Error("BINDING_PROJECT_PATH_INVALID");
    return item as unknown as CodexBinding;
  });
  if (new Set(bindings.map((item) => item.bindingId)).size !== bindings.length || new Set(bindings.map((item) => item.alias.toLocaleLowerCase())).size !== bindings.length) throw new Error("BINDING_DUPLICATE");
  return { version: BINDING_REGISTRY_VERSION, bindings };
}

export function defaultBindingRegistryPath(): string {
  const root = process.env.CHATCOM_USER_DATA?.trim() || (platform() === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ChatCOM")
    : platform() === "darwin" ? join(homedir(), "Library", "Application Support", "ChatCOM") : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "ChatCOM"));
  return join(root, "bindings.json");
}

export class BindingStore {
  constructor(private readonly filePath: string = defaultBindingRegistryPath()) {}

  private async read(): Promise<RegistryFile> {
    try { return registryRecord(JSON.parse(await readFile(this.filePath, "utf8"))); }
    catch (error) { if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return { version: BINDING_REGISTRY_VERSION, bindings: [] }; throw new Error("BINDING_REGISTRY_INVALID"); }
  }

  private async write(registry: RegistryFile): Promise<void> {
    const directory = dirname(this.filePath); await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(registry, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async create(alias: string, projectRoot: string, threadId: string, bindingId = randomUUID()): Promise<BindingSummary> {
    assertAlias(alias); assertThreadId(threadId); assertBindingId(bindingId);
    const canonicalProject = await realpath(projectRoot).catch(() => { throw new Error("BINDING_PROJECT_UNAVAILABLE"); });
    const registry = await this.read();
    if (registry.bindings.some((item) => item.alias.toLocaleLowerCase() === alias.trim().toLocaleLowerCase())) throw new Error("BINDING_ALIAS_DUPLICATE");
    const binding: CodexBinding = { bindingId, alias: alias.trim(), projectRoot: canonicalProject, threadId, createdAt: new Date().toISOString(), mode: "PERSISTENT_BOUND", state: "VALID" };
    registry.bindings.push(binding); await this.write(registry); return this.summary(binding);
  }

  async get(bindingId: string, expectedProjectRoot?: string): Promise<CodexBinding> {
    assertBindingId(bindingId);
    const binding = (await this.read()).bindings.find((item) => item.bindingId === bindingId && item.state === "VALID");
    if (!binding) throw new Error("BINDING_NOT_FOUND");
    if (expectedProjectRoot !== undefined) {
      const canonical = await realpath(expectedProjectRoot).catch(() => { throw new Error("BINDING_PROJECT_UNAVAILABLE"); });
      if (binding.projectRoot !== canonical) throw new Error("BINDING_PROJECT_DIFFERENT");
    }
    return binding;
  }

  async validate(bindingId: string, expectedProjectRoot?: string): Promise<BindingSummary> {
    assertBindingId(bindingId);
    const binding = (await this.read()).bindings.find((item) => item.bindingId === bindingId);
    if (!binding) return { bindingId, alias: "", projectRoot: "", createdAt: "", mode: "PERSISTENT_BOUND", state: "NOT_FOUND", threadTail: "" };
    if (binding.state === "DISABLED") return { ...this.summary(binding), state: "DISABLED" };
    if (expectedProjectRoot !== undefined) {
      const canonical = await realpath(expectedProjectRoot).catch(() => { throw new Error("BINDING_PROJECT_UNAVAILABLE"); });
      if (binding.projectRoot !== canonical) return { ...this.summary(binding), state: "PROJECT_DIFFERENT" };
    }
    return this.summary(binding);
  }

  async list(): Promise<BindingSummary[]> { return (await this.read()).bindings.map((binding) => this.summary(binding)); }

  async disable(bindingId: string): Promise<void> { await this.setState(bindingId, "DISABLED"); }
  async remove(bindingId: string): Promise<void> {
    assertBindingId(bindingId); const registry = await this.read(); const before = registry.bindings.length; registry.bindings = registry.bindings.filter((item) => item.bindingId !== bindingId); if (registry.bindings.length === before) throw new Error("BINDING_NOT_FOUND"); await this.write(registry);
  }

  private async setState(bindingId: string, state: BindingState): Promise<void> { assertBindingId(bindingId); const registry = await this.read(); const binding = registry.bindings.find((item) => item.bindingId === bindingId); if (!binding) throw new Error("BINDING_NOT_FOUND"); binding.state = state; await this.write(registry); }
  private summary(binding: CodexBinding): BindingSummary { return { bindingId: binding.bindingId, alias: binding.alias, projectRoot: binding.projectRoot, createdAt: binding.createdAt, mode: binding.mode, state: binding.state, threadTail: `…${binding.threadId.slice(-6)}` }; }
  async removeRegistryFileForTests(): Promise<void> { try { await unlink(this.filePath); } catch { /* absent */ } }
}
