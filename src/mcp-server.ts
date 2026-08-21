#!/usr/bin/env node
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { RelayFailure } from "./local-relay.js";
import { loadRelayConfig, RelayConfigError, type PortableRelayConfig } from "./relay-config.js";
import { runPortableRelay, type PortableRelayRunResult } from "./portable-relay.js";

export const CHATCOM_MCP_VERSION = "0.3.0" as const;
export const CHATCOM_VALIDATE_TOOL = "chatcom_validate_config" as const;
export const CHATCOM_RELAY_TOOL = "chatcom_run_relay" as const;

export const CHATCOM_MCP_INSTRUCTIONS =
  "ChatCOM is a local read-only Work-to-Codex relay. Call chatcom_validate_config before chatcom_run_relay. Run the relay only with explicit user authorization. Never copy raw message content into terminal diagnostics. The relay performs exactly three transmissions, stops before a second Codex mission, and fails closed when cleanup is not confirmed.";

const configPathSchema = z.string().trim().min(1).max(4_096).describe("Path to a ChatCOM relay configuration file.");

const messageSchema = z.object({
  version: z.literal("1.0"),
  session_id: z.string(),
  message_id: z.string(),
  correlation_id: z.string(),
  sequence: z.number().int().positive(),
  sender: z.enum(["WORK_LOCAL", "CODEX_LOCAL", "USER"]),
  recipient: z.enum(["WORK_LOCAL", "CODEX_LOCAL", "USER"]),
  type: z.enum(["MISSION", "REPORT", "NEXT_PROMPT", "USER_DECISION_REQUIRED", "ERROR"]),
  phase: z.string(),
  point: z.string(),
  content: z.string(),
  created_at: z.string(),
  delivery_status: z.enum(["CREATED", "SENT", "RECEIVED", "PROCESSED", "FAILED"]),
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
  session_id: z.string(),
  transmissions: z.literal(3),
  stopped_before_second_codex_mission: z.literal(true),
  cleanup: z.literal("CONFIRMED"),
  messages: z.array(messageSchema).length(3),
};

export interface ChatComMcpDependencies {
  loadConfig(path: string): Promise<PortableRelayConfig>;
  runRelay(config: PortableRelayConfig, timeoutMs: number): Promise<PortableRelayRunResult>;
}

const DEFAULT_DEPENDENCIES: ChatComMcpDependencies = {
  loadConfig: loadRelayConfig,
  runRelay: (config, timeoutMs) => runPortableRelay(config, { timeoutMs }),
};

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof RelayConfigError || error instanceof RelayFailure ? error.code : "MCP_INTERNAL_ERROR";
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate) ? candidate : "MCP_INTERNAL_ERROR";
}

function toolFailure(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `CHATCOM_MCP kind=FAILURE code=${safeErrorCode(error)}` }],
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
    async ({ config_path, timeout_ms }) => {
      try {
        const config = await dependencies.loadConfig(resolve(config_path));
        const result = await dependencies.runRelay(config, timeout_ms ?? 600_000);
        const structuredContent = {
          status: "SUCCESS" as const,
          session_id: result.relay.sessionId,
          transmissions: 3 as const,
          stopped_before_second_codex_mission: true as const,
          cleanup: result.cleanup,
          messages: [...result.relay.messages],
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
