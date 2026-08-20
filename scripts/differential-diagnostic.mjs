import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { AppServerClient, isSafeCodexErrorCategory } from "../dist/app-server-client.js";
import { runDifferentialDiagnostic } from "../dist/differential-diagnostic.js";

const TEMP_PREFIX = "chatcom-differential-diagnostic-";
const BASE_INSTRUCTIONS = "You are a synthetic diagnostic agent. Do not use tools or change files. Return one short acknowledgement.";
const PROMPT = "Return one short acknowledgement for this bounded diagnostic.";

function parseArgs(argv) {
  let cliDir;
  let timeoutMs = 120_000;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cli-dir") cliDir = argv[++index];
    else if (arg === "--timeout-ms") timeoutMs = Number(argv[++index]);
    else throw new Error("INVALID_ARGUMENTS");
  }
  if (typeof cliDir !== "string" || !isAbsolute(cliDir) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new Error("INVALID_ARGUMENTS");
  return { cliDir: resolve(cliDir), timeoutMs };
}

async function resolveExecutable(cliDir) {
  const executable = join(cliDir, process.platform === "win32" ? "codex.exe" : "codex");
  const info = await stat(executable);
  if (!info.isFile()) throw new Error("CLI_NOT_EXECUTABLE");
  return executable;
}

function safeDiagnosticCategory(diagnostic) {
  if (typeof diagnostic?.category === "string") return isSafeCodexErrorCategory(diagnostic.category) ? diagnostic.category : "UNKNOWN";
  return diagnostic?.categoryUnknown === true ? "UNKNOWN" : "ABSENT";
}

function safeDiagnosticInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? String(value) : "ABSENT";
}

function safeDiagnosticSuffix(diagnostic) {
  if (diagnostic === undefined) return "";
  const retryCount = safeDiagnosticInteger(diagnostic.retryCount, 64);
  const retryNumber = retryCount === "ABSENT" ? undefined : Number(retryCount);
  const willRetry = retryNumber !== undefined && typeof diagnostic.willRetry === "boolean" ? String(diagnostic.willRetry) : "ABSENT";
  const categories = Object.entries(diagnostic.retryCategoryCounts ?? {})
    .filter(([category, count]) => isSafeCodexErrorCategory(category) && Number.isSafeInteger(count) && count >= 1 && count <= 64)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8);
  const retryCategories = categories.reduce((sum, [, count]) => sum + count, 0) <= (retryNumber ?? 0)
    ? (categories.length === 0 ? "ABSENT" : categories.map(([category, count]) => `${category}~${count}`).join(","))
    : "ABSENT";
  const finalStatus = diagnostic.finalStatus === "completed" || diagnostic.finalStatus === "interrupted" || diagnostic.finalStatus === "failed" ? diagnostic.finalStatus : "ABSENT";
  return ` diagnosticCategory=${safeDiagnosticCategory(diagnostic)} diagnosticHttpStatusCode=${safeDiagnosticInteger(diagnostic.httpStatusCode, 65_535)} diagnosticWillRetry=${willRetry} diagnosticRetryCount=${retryCount} diagnosticRetryCategories=${retryCategories} diagnosticFinalStatus=${finalStatus}`;
}

function formatResult(result, tempRemoved) {
  return `DIFFERENTIAL failure=${result.failure} modelSelectedFromList=${result.modelSelectedFromList} failedStage=${result.failedStage ?? "NONE"} minimalTurn=${result.minimalTurn} schemaTurn=${result.schemaTurn} minimalCleanup=${result.minimalCleanup} schemaCleanup=${result.schemaCleanup} clientClosed=${result.clientClosed} tempRemoved=${tempRemoved}${safeDiagnosticSuffix(result.diagnostic)}`;
}

export async function runCommand(argv, dependencies = {}) {
  let tempDir;
  let tempRemoved = false;
  let result;
  let client;
  try {
    const args = parseArgs(argv);
    const executableResolver = dependencies.resolveExecutable ?? resolveExecutable;
    const executable = await executableResolver(args.cliDir);
    tempDir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    client = (dependencies.spawnClient ?? (() => AppServerClient.spawn({ requestMs: 30_000, turnMs: args.timeoutMs, cleanupMs: 3_000 }, executable)))();
    try {
      await client.initialize();
      result = await runDifferentialDiagnostic(client, { cwd: tempDir, baseInstructions: BASE_INSTRUCTIONS, prompt: PROMPT });
    } catch {
      let clientClosed = false;
      try {
        const closed = await client.close();
        clientClosed = closed.exited && !closed.forced;
      } catch { /* bounded terminal result below */ }
      result = {
        kind: "DIFFERENTIAL",
        failure: "DIAGNOSTIC_INITIALIZATION_FAILED",
        modelSelectedFromList: false,
        failedStage: "NONE",
        minimalTurn: "NOT_RUN",
        schemaTurn: "NOT_RUN",
        minimalCleanup: "NOT_REQUIRED",
        schemaCleanup: "NOT_RUN",
        clientClosed,
      };
    }
  } catch {
    result = {
      kind: "DIFFERENTIAL",
      failure: "DIAGNOSTIC_BOOTSTRAP_FAILED",
      modelSelectedFromList: false,
      failedStage: "NONE",
      minimalTurn: "NOT_RUN",
      schemaTurn: "NOT_RUN",
      minimalCleanup: "NOT_REQUIRED",
      schemaCleanup: "NOT_RUN",
      clientClosed: false,
    };
  } finally {
    if (tempDir !== undefined) {
      try { await rm(tempDir, { recursive: true, force: false }); tempRemoved = true; }
      catch {
        result = {
          ...(result ?? {}),
          kind: "DIFFERENTIAL",
          failure: "CLEANUP_FAILED",
          modelSelectedFromList: result?.modelSelectedFromList ?? false,
          minimalTurn: result?.minimalTurn ?? "NOT_RUN",
          schemaTurn: result?.schemaTurn ?? "NOT_RUN",
          minimalCleanup: "FAILED",
          schemaCleanup: result?.schemaCleanup ?? "NOT_RUN",
          clientClosed: result?.clientClosed ?? false,
        };
      }
    }
  }
  const line = formatResult(result, tempRemoved);
  return { line, exitCode: result.failure === "NONE" && result.clientClosed && tempRemoved ? 0 : 1 };
}

if (process.argv[1]?.endsWith("differential-diagnostic.mjs")) {
    runCommand(process.argv.slice(2)).then(({ line, exitCode }) => { process.stdout.write(`${line}\n`); process.exitCode = exitCode; }).catch(() => { process.stdout.write("DIFFERENTIAL failure=DIAGNOSTIC_BOOTSTRAP_FAILED modelSelectedFromList=false failedStage=NONE minimalTurn=NOT_RUN schemaTurn=NOT_RUN minimalCleanup=NOT_REQUIRED schemaCleanup=NOT_RUN clientClosed=false tempRemoved=false\n"); process.exitCode = 1; });
}
