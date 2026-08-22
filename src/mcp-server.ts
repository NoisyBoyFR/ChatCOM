#!/usr/bin/env node
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { AppServerClientError } from "./app-server-client.js";
import { RelayFailure } from "./local-relay.js";
import { MAX_CONTENT_BYTES, MAX_ROUTE_BYTES, DELIVERY_STATUSES, MESSAGE_DATE_PATTERN, MESSAGE_ROLES, MESSAGE_TYPES, MESSAGE_UUID_PATTERN, validateRelayMessages, type MessageEnvelope } from "./message-contract.js";
import { loadRelayConfig, RelayConfigError, type PortableRelayConfig } from "./relay-config.js";
import { runPortableRelay, type PortableRelayRunResult } from "./portable-relay.js";
import { WorkHostBridge, type WorkHostOpenResult, type WorkHostCompleteResult } from "./work-host-bridge.js";
import { BindingStore, defaultBindingRegistryPath } from "./desktop/bindings.js";

const packageRequire = createRequire(import.meta.url);
const packageMetadata = packageRequire("../package.json") as { version?: unknown };
if (typeof packageMetadata.version !== "string" || packageMetadata.version.trim().length === 0) throw new Error("PACKAGE_VERSION_INVALID");
export const CHATCOM_MCP_VERSION = packageMetadata.version;
export const CHATCOM_VALIDATE_TOOL = "chatcom_validate_config" as const;
export const CHATCOM_RELAY_TOOL = "chatcom_run_relay" as const;
export const CHATCOM_WORK_OPEN_TOOL = "chatcom_work_open" as const;
export const CHATCOM_WORK_COMPLETE_TOOL = "chatcom_work_complete" as const;
export const CHATCOM_BINDING_CREATE_TOOL = "chatcom_binding_create" as const;
export const CHATCOM_BINDING_VALIDATE_TOOL = "chatcom_binding_validate" as const;
export const CHATCOM_BINDING_LIST_TOOL = "chatcom_binding_list" as const;
export const CHATCOM_BINDING_DISABLE_TOOL = "chatcom_binding_disable" as const;
export const CHATCOM_BINDING_REMOVE_TOOL = "chatcom_binding_remove" as const;

export const CHATCOM_MCP_INSTRUCTIONS =
  "ChatCOM is a local read-only Work-to-Codex relay. Call chatcom_validate_config before a relay. Use the local binding tools only for explicit exact-UUID registry operations. For a real host exchange, call chatcom_work_open with a validated WORK_HOST MISSION, let the MCP host analyze the returned REPORT, then call chatcom_work_complete with exactly one WORK_HOST NEXT_PROMPT. Omit binding_id for the default EPHEMERAL lifecycle; pass a validated binding_id for PERSISTENT_BOUND resume and preserved cleanup. WORK authentication is managed by the host; ChatCOM never reads host credentials. Every real-host exchange performs exactly three transmissions, never runs a second Codex mission, and fails closed when cleanup is not confirmed. The legacy chatcom_run_relay tool is LOCAL_SIMULATION only and requires explicit user authorization.";

const configPathSchema = z.string().trim().min(1).max(4_096).describe("Path to a ChatCOM relay configuration file.");
const uuidSchema = z.string().regex(MESSAGE_UUID_PATTERN);
const utf8TextSchema = (maximumBytes: number, description: string) =>
  z.string().min(1).refine((value) => value.trim().length > 0, { message: description }).refine((value) => Buffer.byteLength(value, "utf8") <= maximumBytes, { message: description }).describe(description);
const dateSchema = z.string().regex(MESSAGE_DATE_PATTERN).refine((value) => {
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
}, { message: "Date must be a canonical ISO instant." });

const messageSchema = z.object({
  version: z.literal("1.0"),
  session_id: uuidSchema,
  message_id: uuidSchema,
  correlation_id: uuidSchema,
  sequence: z.number().int().positive(),
  sender: z.enum(MESSAGE_ROLES),
  recipient: z.enum(MESSAGE_ROLES),
  type: z.enum(MESSAGE_TYPES),
  phase: utf8TextSchema(MAX_ROUTE_BYTES, "UTF-8 length is bounded by the relay route contract."),
  point: utf8TextSchema(MAX_ROUTE_BYTES, "UTF-8 length is bounded by the relay route contract."),
  content: utf8TextSchema(MAX_CONTENT_BYTES, "UTF-8 byte length is bounded by MAX_CONTENT_BYTES at runtime."),
  created_at: dateSchema,
  delivery_status: z.enum(DELIVERY_STATUSES),
  user_action_needed: z.boolean(),
});

const validationOutputSchema = {
  status: z.literal("VALID"),
  config_version: z.literal("1.0"),
  project_root: z.string(),
  phase: z.string(),
  point: z.string(),
};

const relayOutputSchema = {
  status: z.literal("SUCCESS"),
  session_id: uuidSchema,
  transmissions: z.literal(3),
  stopped_before_second_codex_mission: z.literal(true),
  cleanup: z.literal("CONFIRMED"),
  messages: z.array(messageSchema).length(3),
};

export interface ChatComMcpDependencies {
  loadConfig(path: string): Promise<PortableRelayConfig>;
  runRelay(config: PortableRelayConfig, timeoutMs: number, signal?: AbortSignal): Promise<PortableRelayRunResult>;
  workHostBridge?: WorkHostBridge;
  bindingStore?: BindingStore;
}

const DEFAULT_DEPENDENCIES: ChatComMcpDependencies = {
  loadConfig: loadRelayConfig,
  runRelay: (config, timeoutMs, signal) => runPortableRelay(config, { timeoutMs, signal }),
};

const workHostOpenOutputSchema = {
  status: z.literal("REPORT_READY"),
  communication_mode: z.literal("REAL_WORK_HOST"),
  work_host: z.literal("MCP_HOST"),
  work_authentication: z.literal("WORK_AUTH_MANAGED_BY_HOST"),
  codex_authentication: z.literal("CODEX_AUTH_READY"),
  security: z.literal("READ_ONLY"),
  session_id: uuidSchema,
  report: messageSchema,
  transmissions: z.literal(2),
  completed_transmissions: z.literal(2),
  cleanup: z.literal("PENDING"),
  stopped_before_second_codex_mission: z.literal(true),
  conversation_mode: z.enum(["EPHEMERAL", "PERSISTENT_BOUND"]),
  binding_id: uuidSchema.optional(),
  thread_preserved: z.literal("PENDING"),
  thread_deleted: z.literal("PENDING"),
};

const workHostCompleteOutputSchema = {
  status: z.literal("SUCCESS"),
  communication_mode: z.literal("REAL_WORK_HOST"),
  work_host: z.literal("MCP_HOST"),
  work_authentication: z.literal("WORK_AUTH_MANAGED_BY_HOST"),
  codex_authentication: z.literal("CODEX_AUTH_READY"),
  security: z.literal("READ_ONLY"),
  session_id: uuidSchema,
  transmissions: z.literal(3),
  completed_transmissions: z.literal(3),
  cleanup: z.literal("CONFIRMED"),
  stopped_before_second_codex_mission: z.literal(true),
  conversation_mode: z.enum(["EPHEMERAL", "PERSISTENT_BOUND"]),
  binding_id: uuidSchema.optional(),
  thread_preserved: z.enum(["CONFIRMED", "PENDING"]),
  thread_deleted: z.enum(["CONFIRMED", "PENDING"]),
};

function openStructured(result: WorkHostOpenResult) {
  return {
    status: result.status,
    communication_mode: result.communicationMode,
    work_host: result.workHost,
    work_authentication: result.workAuthentication,
    codex_authentication: result.codexAuthentication,
    security: result.security,
    session_id: result.sessionId,
    report: result.report,
    transmissions: result.transmissions,
    completed_transmissions: result.completedTransmissions,
    cleanup: result.cleanup,
    stopped_before_second_codex_mission: result.stoppedBeforeSecondCodexMission,
    conversation_mode: result.conversationMode ?? "EPHEMERAL",
    ...(result.bindingId === undefined ? {} : { binding_id: result.bindingId }),
    thread_preserved: result.threadPreserved ?? "PENDING",
    thread_deleted: result.threadDeleted ?? "PENDING",
  };
}

function completeStructured(result: WorkHostCompleteResult) {
  return {
    status: result.status,
    communication_mode: result.communicationMode,
    work_host: result.workHost,
    work_authentication: result.workAuthentication,
    codex_authentication: result.codexAuthentication,
    security: result.security,
    session_id: result.sessionId,
    transmissions: result.transmissions,
    completed_transmissions: result.completedTransmissions,
    cleanup: result.cleanup,
    stopped_before_second_codex_mission: result.stoppedBeforeSecondCodexMission,
    conversation_mode: result.conversationMode ?? "EPHEMERAL",
    ...(result.bindingId === undefined ? {} : { binding_id: result.bindingId }),
    thread_preserved: result.threadPreserved ?? "PENDING",
    thread_deleted: result.threadDeleted ?? "PENDING",
  };
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof RelayConfigError || error instanceof RelayFailure || error instanceof AppServerClientError ? error.code : "MCP_INTERNAL_ERROR";
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate) ? candidate : "MCP_INTERNAL_ERROR";
}

function safeRelayStage(error: unknown): string {
  if (!(error instanceof RelayFailure)) return "NONE";
  return error.relayStage ?? "NONE";
}

function safeCompletedTransmissions(error: unknown): number {
  return error instanceof RelayFailure && Number.isSafeInteger(error.completedTransmissions) && error.completedTransmissions >= 0 ? error.completedTransmissions : 0;
}

function safeCleanupStatus(error: unknown): "CONFIRMED" | "NOT_CONFIRMED" {
  if (!(error instanceof RelayFailure)) return "NOT_CONFIRMED";
  return error.cleanupFailures.length === 0 && error.cleanupErrors.length === 0 ? "CONFIRMED" : "NOT_CONFIRMED";
}

function safeDiagnostic(error: unknown): {
  sdkStage: string;
  terminal: string;
  threadStarted: boolean | "UNKNOWN";
  turnStarted: boolean | "UNKNOWN";
  streamClosed: boolean | "UNKNOWN";
  failureCategory: string;
} {
  const diagnostic = error instanceof RelayFailure ? error.primaryDiagnostic : error instanceof AppServerClientError ? error.diagnostic : undefined;
  return {
    sdkStage: diagnostic?.sdkStage ?? "UNKNOWN",
    terminal: diagnostic?.terminal ?? "UNKNOWN",
    threadStarted: diagnostic?.threadStarted ?? "UNKNOWN",
    turnStarted: diagnostic?.turnStarted ?? "UNKNOWN",
    streamClosed: diagnostic?.streamClosed ?? "UNKNOWN",
    failureCategory: diagnostic?.failureCategory ?? "UNKNOWN",
  };
}

function assertMcpSerializable(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("undefined");
    JSON.parse(serialized);
  } catch {
    throw new RelayFailure("MCP_RESULT_NOT_SERIALIZABLE");
  }
}

function toolFailure(error: unknown) {
  const diagnostic = safeDiagnostic(error);
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `CHATCOM_MCP kind=FAILURE code=${safeErrorCode(error)} relay_stage=${safeRelayStage(error)} completed_transmissions=${safeCompletedTransmissions(error)} cleanup=${safeCleanupStatus(error)} sdk_stage=${diagnostic.sdkStage} terminal=${diagnostic.terminal} thread_started=${diagnostic.threadStarted} turn_started=${diagnostic.turnStarted} stream_closed=${diagnostic.streamClosed} failure_category=${diagnostic.failureCategory}`,
    }],
  };
}

export function createChatComMcpServer(dependencies: ChatComMcpDependencies = DEFAULT_DEPENDENCIES): McpServer {
  const workHostBridge = dependencies.workHostBridge ?? new WorkHostBridge();
  const bindingStore = dependencies.bindingStore ?? new BindingStore(defaultBindingRegistryPath());
  const server = new McpServer(
    { name: "chatcom", version: CHATCOM_MCP_VERSION },
    { instructions: CHATCOM_MCP_INSTRUCTIONS },
  );

  server.registerTool(
    CHATCOM_WORK_OPEN_TOOL,
    {
      title: "Open a real WORK host exchange",
      description: "Accept one validated MISSION from the MCP host, obtain one read-only Codex REPORT, and pause before the WORK host sends NEXT_PROMPT. WORK authentication is managed by the host; ChatCOM does not inspect or receive its secret.",
      inputSchema: {
        config_path: configPathSchema,
        mission: messageSchema,
        timeout_ms: z.number().int().positive().max(3_600_000).optional(),
        idle_timeout_ms: z.number().int().positive().max(3_600_000).optional(),
        binding_id: uuidSchema.optional().describe("Validated local binding identifier. Omit for an ephemeral conversation."),
      },
      outputSchema: workHostOpenOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ config_path, mission, timeout_ms, idle_timeout_ms, binding_id }, extra) => {
      try {
        const config = await dependencies.loadConfig(resolve(config_path));
        const result = await workHostBridge.open(config, mission as MessageEnvelope, timeout_ms, idle_timeout_ms, extra.signal, binding_id);
        const structuredContent = openStructured(result);
        assertMcpSerializable(structuredContent);
        return { structuredContent, content: [{ type: "text" as const, text: "CHATCOM_WORK_HOST kind=REPORT_READY transmissions=2 cleanup=PENDING mode=REAL_WORK_HOST" }] };
      } catch (error) { return toolFailure(error); }
    },
  );

  const bindingSummaryShape = {
    binding_id: uuidSchema,
    alias: utf8TextSchema(256, "Binding alias."),
    project_root: utf8TextSchema(4_096, "Canonical project path."),
    created_at: dateSchema,
    mode: z.literal("PERSISTENT_BOUND"),
    state: z.enum(["VALID", "DISABLED", "PROJECT_DIFFERENT", "NOT_FOUND"]),
    thread_tail: z.string().max(16),
  };
  const bindingSummaryObject = z.object(bindingSummaryShape);
  const bindingFailure = (error: unknown) => toolFailure(error);
  server.registerTool(CHATCOM_BINDING_CREATE_TOOL, {
    title: "Create a local Codex binding",
    description: "Create an explicit local binding by exact thread identifier without contacting Codex. The identifier is never returned.",
    inputSchema: { alias: utf8TextSchema(64, "Readable local alias."), project_root: configPathSchema, thread_id: uuidSchema },
    outputSchema: bindingSummaryShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ alias, project_root, thread_id }) => {
    try { const summary = await bindingStore.create(alias, project_root, thread_id); const structuredContent = { binding_id: summary.bindingId, alias: summary.alias, project_root: summary.projectRoot, created_at: summary.createdAt, mode: summary.mode, state: summary.state, thread_tail: summary.threadTail }; assertMcpSerializable(structuredContent); return { structuredContent, content: [{ type: "text" as const, text: "CHATCOM_BINDING kind=CREATED mode=PERSISTENT_BOUND" }] }; }
    catch (error) { return bindingFailure(error); }
  });
  server.registerTool(CHATCOM_BINDING_VALIDATE_TOOL, {
    title: "Validate a local Codex binding",
    description: "Validate an explicit binding and its project path without contacting Codex or reading conversation history.",
    inputSchema: { binding_id: uuidSchema, project_root: configPathSchema.optional() },
    outputSchema: bindingSummaryShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ binding_id, project_root }) => {
    try { const summary = await bindingStore.validate(binding_id, project_root); const structuredContent = { binding_id: summary.bindingId, alias: summary.alias || "UNKNOWN", project_root: summary.projectRoot || "UNKNOWN", created_at: summary.createdAt || new Date(0).toISOString(), mode: summary.mode, state: summary.state, thread_tail: summary.threadTail }; assertMcpSerializable(structuredContent); return { structuredContent, content: [{ type: "text" as const, text: `CHATCOM_BINDING kind=VALID state=${summary.state}` }] }; }
    catch (error) { return bindingFailure(error); }
  });
  server.registerTool(CHATCOM_BINDING_LIST_TOOL, {
    title: "List local Codex binding aliases",
    description: "List local aliases and masked thread tails without exposing thread identifiers.",
    inputSchema: {}, outputSchema: { bindings: z.array(bindingSummaryObject) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => { try { const bindings = (await bindingStore.list()).map((summary) => ({ binding_id: summary.bindingId, alias: summary.alias, project_root: summary.projectRoot, created_at: summary.createdAt, mode: summary.mode, state: summary.state, thread_tail: summary.threadTail })); const structuredContent = { bindings }; assertMcpSerializable(structuredContent); return { structuredContent, content: [{ type: "text" as const, text: `CHATCOM_BINDING kind=LIST count=${bindings.length}` }] }; } catch (error) { return bindingFailure(error); } });
  for (const [tool, title, action] of [[CHATCOM_BINDING_DISABLE_TOOL, "Disable a local Codex binding", "disable"], [CHATCOM_BINDING_REMOVE_TOOL, "Remove a local Codex binding", "remove"]] as const) {
    server.registerTool(tool, { title, description: "Change only the local registry; never delete the Codex conversation.", inputSchema: { binding_id: uuidSchema }, outputSchema: { status: z.literal("SUCCESS"), binding_id: uuidSchema, thread_deleted: z.literal("NOT_REQUESTED") }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ binding_id }) => {
      try { if (action === "disable") await bindingStore.disable(binding_id); else await bindingStore.remove(binding_id); const structuredContent = { status: "SUCCESS" as const, binding_id, thread_deleted: "NOT_REQUESTED" as const }; assertMcpSerializable(structuredContent); return { structuredContent, content: [{ type: "text" as const, text: `CHATCOM_BINDING kind=${action.toUpperCase()} thread_deleted=NOT_REQUESTED` }] }; }
      catch (error) { return bindingFailure(error); }
    });
  }

  server.registerTool(
    CHATCOM_WORK_COMPLETE_TOOL,
    {
      title: "Complete a real WORK host exchange",
      description: "Accept exactly one validated NEXT_PROMPT from the same MCP host exchange, delete an ephemeral thread or preserve a bound thread, close the client, and confirm cleanup without running a second Codex mission.",
      inputSchema: {
        session_id: uuidSchema,
        next_prompt: messageSchema,
      },
      outputSchema: workHostCompleteOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ session_id, next_prompt }, extra) => {
      try {
        const result = await workHostBridge.complete(session_id, next_prompt as MessageEnvelope, extra.signal);
        const structuredContent = completeStructured(result);
        assertMcpSerializable(structuredContent);
        return { structuredContent, content: [{ type: "text" as const, text: "CHATCOM_WORK_HOST kind=SUCCESS transmissions=3 cleanup=CONFIRMED mode=REAL_WORK_HOST" }] };
      } catch (error) { return toolFailure(error); }
    },
  );

  server.registerTool(
    CHATCOM_VALIDATE_TOOL,
    {
      title: "Validate ChatCOM configuration",
      description: "Validate a local ChatCOM relay configuration without starting Codex or exposing the mission content.",
      inputSchema: { config_path: configPathSchema },
      outputSchema: validationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ config_path }) => {
      try {
        const config = await dependencies.loadConfig(resolve(config_path));
        const structuredContent = {
          status: "VALID" as const,
          config_version: config.version,
          project_root: config.projectRoot,
          phase: config.phase,
          point: config.point,
        };
        assertMcpSerializable(structuredContent);
        return {
          structuredContent,
          content: [{ type: "text" as const, text: `CHATCOM_CONFIG kind=VALID version=${config.version}` }],
        };
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    CHATCOM_RELAY_TOOL,
    {
      title: "Run authorized ChatCOM relay",
      description: "Run one explicitly authorized, read-only, three-transmission Work-to-Codex relay and return its validated envelopes.",
      inputSchema: {
        config_path: configPathSchema,
        timeout_ms: z.number().int().positive().max(3_600_000).optional().describe("Per-turn timeout in milliseconds."),
      },
      outputSchema: relayOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ config_path, timeout_ms }, extra) => {
      try {
        const config = await dependencies.loadConfig(resolve(config_path));
        const result = await dependencies.runRelay(config, timeout_ms ?? 600_000, extra.signal);
        const messages = validateRelayMessages(result.relay.messages);
        if (result.relay.sessionId !== messages[0].session_id) throw new RelayFailure("RELAY_SESSION_MISMATCH");
        const structuredContent = {
          status: "SUCCESS" as const,
          session_id: result.relay.sessionId,
          transmissions: 3 as const,
          stopped_before_second_codex_mission: true as const,
          cleanup: result.cleanup,
          messages: [...messages],
        };
        assertMcpSerializable(structuredContent);
        return {
          structuredContent,
          content: [{ type: "text" as const, text: "CHATCOM_RELAY kind=SUCCESS transmissions=3 cleanup=CONFIRMED" }],
        };
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  return server;
}

export async function startChatComMcpServer(): Promise<void> {
  const server = createChatComMcpServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("mcp-server.js")) {
  void startChatComMcpServer().catch(() => {
    process.stderr.write("CHATCOM_MCP_SERVER kind=FAILURE code=SERVER_START_FAILED\n");
    process.exitCode = 1;
  });
}
