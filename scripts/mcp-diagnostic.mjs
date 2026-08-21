import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedTools = ["chatcom_validate_config", "chatcom_run_relay"];
let temporaryDirectory;
let transport;
let client;
let stderr = "";
let stage = "SETUP";
let transmissions = 0;
let cleanup = "NOT_CONFIRMED";
let processExited = false;
let tempRemoved = false;
let failure = "NONE";

function recordFailure(code) {
  if (failure === "NONE") failure = code;
}

try {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "chatcom-mcp-proof-"));
  const configPath = join(temporaryDirectory, "relay.json");
  await writeFile(configPath, JSON.stringify({
    version: "1.0",
    project_root: projectRoot,
    phase: "CHATCOM-V0.3-PROOF",
    point: "MCP-STDIO",
    mission: "Inspect this repository without changing files. Return a concise report confirming whether package.json names the package chatcom and AGENTS.md requires read-only execution.",
  }), "utf8");

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(projectRoot, "dist", "mcp-server.js")],
    cwd: projectRoot,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  client = new Client({ name: "chatcom-real-proof", version: "1.0.0" });

  stage = "CONNECT";
  await client.connect(transport);

  stage = "TOOLS";
  const listed = await client.listTools();
  if (JSON.stringify(listed.tools.map(({ name }) => name)) !== JSON.stringify(expectedTools)) throw new Error("tool-list");
  if (listed.tools[0]?.annotations?.readOnlyHint !== true) throw new Error("validate-annotation");
  if (listed.tools[1]?.annotations?.readOnlyHint !== false || listed.tools[1]?.annotations?.openWorldHint !== true) throw new Error("relay-annotation");

  stage = "VALIDATE";
  const validated = await client.callTool({ name: "chatcom_validate_config", arguments: { config_path: configPath } });
  if (validated.isError || validated.structuredContent?.status !== "VALID") throw new Error("validation");

  stage = "RELAY";
  const relayed = await client.callTool(
    { name: "chatcom_run_relay", arguments: { config_path: configPath, timeout_ms: 600_000 } },
    undefined,
    { timeout: 600_000, maxTotalTimeout: 600_000 },
  );
  const structured = relayed.structuredContent;
  const messages = Array.isArray(structured?.messages) ? structured.messages : [];
  if (relayed.isError || structured?.status !== "SUCCESS") throw new Error("relay");
  if (structured?.transmissions !== 3 || structured?.stopped_before_second_codex_mission !== true) throw new Error("relay-count");
  if (structured?.cleanup !== "CONFIRMED" || messages.length !== 3) throw new Error("relay-cleanup");
  if (messages.map(({ type }) => type).join(",") !== "MISSION,REPORT,NEXT_PROMPT") throw new Error("relay-route");
  if (!messages.every(({ content }) => typeof content === "string" && content.trim().length > 0)) throw new Error("relay-content");
  transmissions = 3;
  cleanup = "CONFIRMED";
} catch {
  recordFailure(stage === "SETUP" ? "SETUP_FAILED" : `${stage}_FAILED`);
} finally {
  stage = "CLEANUP";
  if (client !== undefined) {
    try { await client.close(); }
    catch { recordFailure("CLIENT_CLOSE_FAILED"); }
  } else if (transport !== undefined) {
    try { await transport.close(); }
    catch { recordFailure("TRANSPORT_CLOSE_FAILED"); }
  }
  processExited = transport === undefined || transport.pid === null;
  if (!processExited) recordFailure("PROCESS_EXIT_UNCONFIRMED");
  if (stderr.length > 0) recordFailure("SERVER_STDERR_NOT_EMPTY");
  if (temporaryDirectory !== undefined) {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
      tempRemoved = true;
    } catch {
      recordFailure("TEMP_REMOVE_FAILED");
    }
  }
}

if (failure === "NONE") {
  process.stdout.write(`CHATCOM_MCP_PROOF kind=SUCCESS code=OK tools=2 transmissions=${transmissions} cleanup=${cleanup} processExited=${processExited} tempRemoved=${tempRemoved}\n`);
} else {
  process.stdout.write(`CHATCOM_MCP_PROOF kind=FAILURE code=${failure} tools=0 transmissions=${transmissions} cleanup=${cleanup} processExited=${processExited} tempRemoved=${tempRemoved}\n`);
  process.exitCode = 1;
}
