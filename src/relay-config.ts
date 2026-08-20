import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { validateLocalRelayRequest, type LocalRelayRequest } from "./local-relay.js";

export const RELAY_CONFIG_VERSION = "1.0" as const;
export const MAX_RELAY_CONFIG_BYTES = 65_536;

export interface PortableRelayConfig {
  version: typeof RELAY_CONFIG_VERSION;
  projectRoot: string;
  phase: string;
  point: string;
  mission: string;
  workInstructions?: string;
  codexInstructions?: string;
}

export class RelayConfigError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RelayConfigError";
  }
}

const REQUIRED_KEYS = ["version", "project_root", "phase", "point", "mission"] as const;
const OPTIONAL_KEYS = ["work_instructions", "codex_instructions"] as const;
const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RelayConfigError("CONFIG_ROOT_NOT_OBJECT");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new RelayConfigError(code);
  return value;
}

export function parseRelayConfig(value: unknown, baseDirectory: string): PortableRelayConfig {
  const input = record(value);
  const keys = Object.keys(input);
  if (keys.some((key) => !ALLOWED_KEYS.has(key)) || REQUIRED_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(input, key))) {
    throw new RelayConfigError("CONFIG_KEYS_INVALID");
  }
  if (input.version !== RELAY_CONFIG_VERSION) throw new RelayConfigError("CONFIG_VERSION_UNSUPPORTED");
  const projectRootValue = stringValue(input.project_root, "CONFIG_PROJECT_ROOT_INVALID");
  const projectRoot = resolve(baseDirectory, projectRootValue);
  const request: LocalRelayRequest = {
    cwd: projectRoot,
    phase: stringValue(input.phase, "CONFIG_PHASE_INVALID"),
    point: stringValue(input.point, "CONFIG_POINT_INVALID"),
    mission: stringValue(input.mission, "CONFIG_MISSION_INVALID"),
    ...(input.work_instructions === undefined ? {} : { workInstructions: stringValue(input.work_instructions, "CONFIG_WORK_INSTRUCTIONS_INVALID") }),
    ...(input.codex_instructions === undefined ? {} : { codexInstructions: stringValue(input.codex_instructions, "CONFIG_CODEX_INSTRUCTIONS_INVALID") }),
  };
  try {
    validateLocalRelayRequest(request);
  } catch (error) {
    throw new RelayConfigError(error instanceof Error ? error.message : "CONFIG_INVALID");
  }
  return {
    version: RELAY_CONFIG_VERSION,
    projectRoot,
    phase: request.phase,
    point: request.point,
    mission: request.mission,
    ...(request.workInstructions === undefined ? {} : { workInstructions: request.workInstructions }),
    ...(request.codexInstructions === undefined ? {} : { codexInstructions: request.codexInstructions }),
  };
}

export async function loadRelayConfig(path: string): Promise<PortableRelayConfig> {
  const configPath = isAbsolute(path) ? path : resolve(path);
  let bytes: Buffer;
  try {
    bytes = await readFile(configPath);
  } catch {
    throw new RelayConfigError("CONFIG_READ_FAILED");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELAY_CONFIG_BYTES) throw new RelayConfigError("CONFIG_SIZE_INVALID");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RelayConfigError("CONFIG_UTF8_INVALID");
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new RelayConfigError("CONFIG_JSON_INVALID");
  }
  const config = parseRelayConfig(value, dirname(configPath));
  try {
    const canonicalRoot = await realpath(config.projectRoot);
    const rootStats = await stat(canonicalRoot);
    if (!rootStats.isDirectory()) throw new Error("not-directory");
    return { ...config, projectRoot: canonicalRoot };
  } catch {
    throw new RelayConfigError("CONFIG_PROJECT_ROOT_UNAVAILABLE");
  }
}
