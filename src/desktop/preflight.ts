import { spawn } from "node:child_process";
import { access, constants as fsConstants, realpath, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveBundledCodexRuntime, EXPECTED_RUNTIME_VERSION } from "../codex-sdk-relay.js";

export type PreflightStatus = "READY" | "ERROR" | "REQUIRED" | "UNKNOWN";
export interface PreflightResult {
  runtime: { status: PreflightStatus; version?: string; architecture?: string };
  authentication: { status: PreflightStatus };
  project: { status: PreflightStatus };
  security: "READ_ONLY";
  canStart: boolean;
}

export interface RuntimeInspection {
  executablePath: string;
  packageVersion: string;
  architecture: string;
}

export interface PreflightCommandResult {
  exitCode: number | null;
  output: string;
}

export interface PreflightDependencies {
  inspectRuntime(): Promise<RuntimeInspection>;
  runCommand(executablePath: string, args: readonly string[], timeoutMs: number): Promise<PreflightCommandResult>;
  checkProject(projectRoot: string): Promise<boolean>;
  checkCodexHome(): Promise<boolean>;
}

const PREFLIGHT_TIMEOUT_MS = 5_000;
const MAX_COMMAND_OUTPUT_BYTES = 4_096;

function isExpectedRuntimeVersion(version: unknown): version is string {
  return typeof version === "string" && (version === EXPECTED_RUNTIME_VERSION || version.startsWith(`${EXPECTED_RUNTIME_VERSION}-`));
}

function statusResult(runtime: PreflightResult["runtime"], authentication: PreflightResult["authentication"], project: PreflightResult["project"]): PreflightResult {
  return { runtime, authentication, project, security: "READ_ONLY", canStart: runtime.status === "READY" && authentication.status === "READY" && project.status === "READY" };
}

function classifyAuthentication(result: PreflightCommandResult): PreflightStatus {
  if (result.exitCode === 0) return "READY";
  const safeText = result.output.toLowerCase();
  if (/\b(login|required|authenticate|not authenticated|unauthori[sz]ed)\b/u.test(safeText)) return "REQUIRED";
  return "UNKNOWN";
}

function extractVersion(output: string): string | undefined {
  const match = output.match(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/u);
  return match?.[0];
}

async function inspectRuntime(): Promise<RuntimeInspection> {
  const executablePath = await resolveBundledCodexRuntime();
  const packageRoot = dirname(dirname(dirname(dirname(executablePath))));
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
  if (!isExpectedRuntimeVersion(metadata.version)) throw new Error("RUNTIME_VERSION_INVALID");
  return { executablePath, packageVersion: metadata.version, architecture: process.arch };
}

function runCommand(executablePath: string, args: readonly string[], timeoutMs: number): Promise<PreflightCommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(executablePath, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const finish = (result: PreflightCommandResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      clearTimeout(timer);
      finish({ exitCode: null, output });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(output, "utf8") < MAX_COMMAND_OUTPUT_BYTES) output = `${output}${chunk}`.slice(0, MAX_COMMAND_OUTPUT_BYTES);
    });
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); finish({ exitCode: null, output }); });
    child.once("close", (exitCode) => { clearTimeout(timer); finish({ exitCode, output }); });
  });
}

async function checkProject(projectRoot: string): Promise<boolean> {
  try {
    const canonical = await realpath(projectRoot);
    const details = await stat(canonical);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function checkCodexHome(): Promise<boolean> {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  try {
    await access(codexHome, fsConstants.F_OK | fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_DEPENDENCIES: PreflightDependencies = { inspectRuntime, runCommand, checkProject, checkCodexHome };

export async function runDesktopPreflight(projectRoot: string, dependencies: PreflightDependencies = DEFAULT_DEPENDENCIES): Promise<PreflightResult> {
  const projectReady = await dependencies.checkProject(projectRoot);
  const project = { status: projectReady ? "READY" : "ERROR" } as const;
  let runtime: PreflightResult["runtime"];
  let authentication: PreflightResult["authentication"];
  try {
    const inspected = await dependencies.inspectRuntime();
    const versionProbe = await dependencies.runCommand(inspected.executablePath, ["--version"], PREFLIGHT_TIMEOUT_MS);
    const reportedVersion = extractVersion(versionProbe.output);
    const versionReady = versionProbe.exitCode === 0 && reportedVersion === EXPECTED_RUNTIME_VERSION && isExpectedRuntimeVersion(inspected.packageVersion);
    runtime = versionReady
      ? { status: "READY", version: reportedVersion, architecture: inspected.architecture }
      : { status: "ERROR", ...(reportedVersion === undefined ? {} : { version: reportedVersion }), architecture: inspected.architecture };
    const authProbe = await dependencies.runCommand(inspected.executablePath, ["login", "status"], PREFLIGHT_TIMEOUT_MS);
    authentication = { status: versionReady ? classifyAuthentication(authProbe) : "UNKNOWN" };
  } catch {
    runtime = { status: "ERROR" };
    authentication = { status: "UNKNOWN" };
  }
  if (!(await dependencies.checkCodexHome())) authentication = { status: "UNKNOWN" };
  return statusResult(runtime, authentication, project);
}
