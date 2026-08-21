#!/usr/bin/env node
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { RelayFailure } from "./local-relay.js";
import { MAX_CONTENT_BYTES, MAX_ROUTE_BYTES, DELIVERY_STATUSES, MESSAGE_DATE_PATTERN, MESSAGE_ROLES, MESSAGE_TYPES, MESSAGE_UUID_PATTERN, validateRelayMessages } from "./message-contract.js";
import { loadRelayConfig, RelayConfigError, type PortableRelayConfig } from "./relay-config.js";
import { runPortableRelay, type PortableRelayRunResult } from "./portable-relay.js";

const packageRequire = createRequire(import.meta.url);
const packageMetadata = packageRequire("../package.json") as { version?: unknown };
if (typeof packageMetadata.version !== "string" || packageMetadata.version.trim().length === 0) throw new Error("PACKAGE_VERSION_INVALID");
export const CHATCOM_MCP_VERSION = packageMetadata.version;
export const CHATCOM_VALIDATE_TOOL = "chatcom_validate_config" as const;
export const CHATCOM_RELAY_TOOL = "chatcom_run_relay" as const;

export const CHATCOM_MCP_INSTRUCTIONS =
  "ChatCOM is a local read-only Work-to-Codex relay. Call chatcom_validate_config before chatcom_run_relay. Run the relay only with explicit user authorization. Never copy raw message content into terminal diagnostics. The relay performs exactly three transmissions, stops before a second Codex mission, and fails closed when cleanup is not confirmed.";

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
}

const DEFAULT_DEPENDENCIES: ChatComMcpDependencies = {
  loadConfig: loadRelayConfig,
  runRelay: (config, timeoutMs, signal) => runPortableRelay(config, { timeoutMs, signal }),
};

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof RelayConfigError || error instanceof RelayFailure ? error.code : "MCP_INTERNAL_ERROR";
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

function toolFailure(error: unknown) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `CHATCOM_MCP kind=FAILURE code=${safeErrorCode(error)} relay_stage=${safeRelayStage(error)} completed_transmissions=${safeCompletedTransmissions(error)} cleanup=${safeCleanupStatus(error)}`,
    }],
  };
}

export function createChatComMcpServer(dependencies: ChatComMcpDependencies = DEFAULT_DEPENDENCIES): McpServer {
  const server = new McpServer(
    { name: "chatcom", version: CHATCOM_MCP_VERSION },
    { instructions: CHATCOM_MCP_INSTRUCTIONS },
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
