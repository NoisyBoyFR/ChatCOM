import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CHATCOM_MCP_INSTRUCTIONS,
  CHATCOM_MCP_VERSION,
  CHATCOM_RELAY_TOOL,
  CHATCOM_VALIDATE_TOOL,
  createChatComMcpServer,
  type ChatComMcpDependencies,
} from "../mcp-server.js";
import { createMessageForTests, RelayFailure } from "../local-relay.js";
import { RelayConfigError, type PortableRelayConfig } from "../relay-config.js";
import type { MessageEnvelope } from "../message-contract.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function config(): PortableRelayConfig {
  return {
    version: "1.0",
    projectRoot: resolve("synthetic-project"),
    phase: "MCP-TEST",
    point: "BRIDGE",
    mission: "LEAK_SENTINEL_MISSION_CONFIG",
  };
}

function messages(): readonly [MessageEnvelope, MessageEnvelope, MessageEnvelope] {
  const mission = createMessageForTests({ session_id: sessionId, message_id: "22222222-2222-4222-8222-222222222222", correlation_id: sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase: "MCP-TEST", point: "BRIDGE", content: "LEAK_SENTINEL_MISSION", user_action_needed: false });
  const report = createMessageForTests({ session_id: sessionId, message_id: "33333333-3333-4333-8333-333333333333", correlation_id: mission.message_id, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", phase: "MCP-TEST", point: "BRIDGE", content: "LEAK_SENTINEL_REPORT", user_action_needed: false });
  const nextPrompt = createMessageForTests({ session_id: sessionId, message_id: "44444444-4444-4444-8444-444444444444", correlation_id: report.message_id, sequence: 3, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", phase: "MCP-TEST", point: "BRIDGE", content: "LEAK_SENTINEL_NEXT_PROMPT", user_action_needed: false });
  return [mission, report, nextPrompt];
}

async function connectedClient(dependencies: ChatComMcpDependencies) {
  const server = createChatComMcpServer(dependencies);
  const client = new Client({ name: "chatcom-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .filter((item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

test("advertises focused tools with accurate safety annotations and server-wide instructions", async () => {
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => config(),
    runRelay: async () => { throw new Error("must-not-run"); },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), [CHATCOM_VALIDATE_TOOL, CHATCOM_RELAY_TOOL]);
    assert.equal(listed.tools[0]?.annotations?.readOnlyHint, true);
    assert.equal(listed.tools[0]?.annotations?.openWorldHint, false);
    assert.equal(listed.tools[1]?.annotations?.readOnlyHint, false);
    assert.equal(listed.tools[1]?.annotations?.openWorldHint, true);
    assert.equal(listed.tools.every((tool) => tool.annotations?.destructiveHint === false), true);
    assert.equal(client.getInstructions(), CHATCOM_MCP_INSTRUCTIONS);
    assert.equal(client.getServerVersion()?.version, CHATCOM_MCP_VERSION);
    assert.match(client.getInstructions() ?? "", /explicit user authorization/u);
  } finally {
    await client.close();
    await server.close();
  }
});

test("validates configuration without returning mission content", async () => {
  let loadedPath = "";
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async (path) => { loadedPath = path; return config(); },
    runRelay: async () => { throw new Error("must-not-run"); },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const result = await client.callTool({ name: CHATCOM_VALIDATE_TOOL, arguments: { config_path: "relay.json" } });
    assert.equal(result.isError, undefined);
    assert.equal(loadedPath, resolve("relay.json"));
    assert.deepEqual(result.structuredContent, {
      status: "VALID",
      config_version: "1.0",
      project_root: config().projectRoot,
      phase: "MCP-TEST",
      point: "BRIDGE",
    });
    assert.equal(JSON.stringify(result).includes("LEAK_SENTINEL_MISSION_CONFIG"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("returns all validated envelopes through structured MCP content while keeping text bounded", async () => {
  let timeout = 0;
  const expectedMessages = messages();
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => config(),
    runRelay: async (_config, timeoutMs) => {
      timeout = timeoutMs;
      return {
        relay: {
          sessionId,
          threadIds: ["thread-1", "thread-2"],
          deletedThreadIds: ["thread-2", "thread-1"],
          messages: expectedMessages,
          messageIds: expectedMessages.map(({ message_id }) => message_id),
          sequence: [1, 2, 3],
          transmissions: 3,
          completedTransmissions: 3,
          stoppedBeforeSecondCodexMission: true,
          requiresUserDecision: false,
          cleanupFailures: [],
          cleanupErrors: [],
        },
        cleanup: "CONFIRMED",
      };
    },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const result = await client.callTool({ name: CHATCOM_RELAY_TOOL, arguments: { config_path: "relay.json", timeout_ms: 45_000 } });
    assert.equal(result.isError, undefined);
    assert.equal(timeout, 45_000);
    assert.deepEqual((result.structuredContent as { messages: MessageEnvelope[] }).messages, expectedMessages);
    assert.equal(textContent(result), "CHATCOM_RELAY kind=SUCCESS transmissions=3 cleanup=CONFIRMED");
    assert.equal(textContent(result).includes("LEAK_SENTINEL"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("passes the MCP request signal to the relay dependency", async () => {
  let receivedSignal: AbortSignal | undefined;
  const expectedMessages = messages();
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => config(),
    runRelay: async (_config, _timeoutMs, signal) => {
      receivedSignal = signal;
      return {
        relay: {
          sessionId,
          threadIds: [],
          deletedThreadIds: [],
          messages: expectedMessages,
          messageIds: expectedMessages.map(({ message_id }) => message_id),
          sequence: [1, 2, 3],
          transmissions: 3,
          completedTransmissions: 3,
          stoppedBeforeSecondCodexMission: true,
          requiresUserDecision: false,
          cleanupFailures: [],
          cleanupErrors: [],
        },
        cleanup: "CONFIRMED",
      };
    },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const controller = new AbortController();
    const result = await client.callTool({ name: CHATCOM_RELAY_TOOL, arguments: { config_path: "relay.json" } }, undefined, { signal: controller.signal });
    assert.equal(result.isError, undefined);
    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal?.aborted, false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("rejects a relay session mismatch without exposing envelope content", async () => {
  const expectedMessages = messages();
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => config(),
    runRelay: async () => ({
      relay: {
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        threadIds: [],
        deletedThreadIds: [],
        messages: expectedMessages,
        messageIds: expectedMessages.map(({ message_id }) => message_id),
        sequence: [1, 2, 3],
        transmissions: 3,
        completedTransmissions: 3,
        stoppedBeforeSecondCodexMission: true,
        requiresUserDecision: false,
        cleanupFailures: [],
        cleanupErrors: [],
      },
      cleanup: "CONFIRMED",
    }),
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const result = await client.callTool({ name: CHATCOM_RELAY_TOOL, arguments: { config_path: "relay.json" } });
    assert.equal(result.isError, true);
    assert.equal(textContent(result), "CHATCOM_MCP kind=FAILURE code=RELAY_SESSION_MISMATCH relay_stage=NONE completed_transmissions=0 cleanup=CONFIRMED");
    assert.equal(JSON.stringify(result).includes("LEAK_SENTINEL"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("bounds tool failures without exposing arbitrary errors", async () => {
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => { throw new Error("LEAK_SENTINEL_STACK"); },
    runRelay: async () => { throw new Error("must-not-run"); },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const unknown = await client.callTool({ name: CHATCOM_VALIDATE_TOOL, arguments: { config_path: "secret.json" } });
    assert.equal(unknown.isError, true);
    assert.equal(textContent(unknown), "CHATCOM_MCP kind=FAILURE code=MCP_INTERNAL_ERROR relay_stage=NONE completed_transmissions=0 cleanup=NOT_CONFIRMED");
    assert.equal(JSON.stringify(unknown).includes("LEAK_SENTINEL"), false);
  } finally {
    await client.close();
    await server.close();
  }

  const boundedDependencies: ChatComMcpDependencies = {
    loadConfig: async () => { throw new RelayConfigError("CONFIG_READ_FAILED"); },
    runRelay: async () => { throw new Error("must-not-run"); },
  };
  const bounded = await connectedClient(boundedDependencies);
  try {
    const result = await bounded.client.callTool({ name: CHATCOM_VALIDATE_TOOL, arguments: { config_path: "missing.json" } });
    assert.equal(textContent(result), "CHATCOM_MCP kind=FAILURE code=CONFIG_READ_FAILED relay_stage=NONE completed_transmissions=0 cleanup=NOT_CONFIRMED");
  } finally {
    await bounded.client.close();
    await bounded.server.close();
  }
});

test("returns a bounded relay failure diagnostic with cleanup status", async () => {
  const dependencies: ChatComMcpDependencies = {
    loadConfig: async () => config(),
    runRelay: async () => {
      throw new RelayFailure("UNEXPECTED_MESSAGE_ROUTE", ["codex-thread"], ["work-thread", "codex-thread"], ["work-thread"], ["THREAD_DELETE_UNCONFIRMED"], undefined, "CODEX_REPORT", 1);
    },
  };
  const { server, client } = await connectedClient(dependencies);
  try {
    const result = await client.callTool({ name: CHATCOM_RELAY_TOOL, arguments: { config_path: "relay.json" } });
    assert.equal(result.isError, true);
    assert.equal(textContent(result), "CHATCOM_MCP kind=FAILURE code=UNEXPECTED_MESSAGE_ROUTE relay_stage=CODEX_REPORT completed_transmissions=1 cleanup=NOT_CONFIRMED");
    assert.equal(JSON.stringify(result).includes("LEAK_SENTINEL"), false);
    assert.equal(JSON.stringify(result).includes("codex-thread"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("serves deterministic validation over a real STDIO MCP process", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist", "mcp-server.js")],
    cwd: resolve("."),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: "chatcom-stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.notEqual(transport.pid, null);
    const result = await client.callTool({ name: CHATCOM_VALIDATE_TOOL, arguments: { config_path: resolve("relay.config.example.json") } });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { status: string }).status, "VALID");
  } finally {
    await client.close();
  }
  assert.equal(transport.pid, null);
  assert.equal(stderr, "");
});
