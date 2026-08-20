#!/usr/bin/env node
import { resolve } from "node:path";
import { RelayFailure } from "./local-relay.js";
import { loadRelayConfig, RelayConfigError, type PortableRelayConfig } from "./relay-config.js";
import { runPortableRelay, type PortableRelayRunResult } from "./portable-relay.js";

export interface PortableCliDependencies {
  loadConfig(path: string): Promise<PortableRelayConfig>;
  runRelay(config: PortableRelayConfig, timeoutMs: number): Promise<PortableRelayRunResult>;
}

export interface PortableCliOutcome {
  exitCode: number;
  line: string;
}

const DEFAULT_DEPENDENCIES: PortableCliDependencies = {
  loadConfig: loadRelayConfig,
  runRelay: (config, timeoutMs) => runPortableRelay(config, { timeoutMs }),
};

function failure(code: string): PortableCliOutcome {
  return { exitCode: 1, line: `WORK_CODEX_RELAY kind=FAILURE code=${code} transmissions=0 cleanup=NOT_CONFIRMED` };
}

function parseArguments(argv: readonly string[]): { command: "validate" | "run"; configPath: string; timeoutMs: number } {
  const [command, ...rest] = argv;
  if (command !== "validate" && command !== "run") throw new RelayConfigError("CLI_USAGE_INVALID");
  let configPath: string | undefined;
  let timeoutMs = 600_000;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--config" && configPath === undefined) configPath = rest[++index];
    else if (argument === "--timeout-ms" && command === "run") {
      const parsed = Number(rest[++index]);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 3_600_000) throw new RelayConfigError("CLI_TIMEOUT_INVALID");
      timeoutMs = parsed;
    } else throw new RelayConfigError("CLI_USAGE_INVALID");
  }
  if (typeof configPath !== "string" || configPath.trim().length === 0) throw new RelayConfigError("CLI_CONFIG_REQUIRED");
  return { command, configPath: resolve(configPath), timeoutMs };
}

export async function runPortableCli(argv: readonly string[], dependencies: PortableCliDependencies = DEFAULT_DEPENDENCIES): Promise<PortableCliOutcome> {
  try {
    const parsed = parseArguments(argv);
    const config = await dependencies.loadConfig(parsed.configPath);
    if (parsed.command === "validate") return { exitCode: 0, line: `WORK_CODEX_RELAY kind=VALID code=OK version=${config.version}` };
    const result = await dependencies.runRelay(config, parsed.timeoutMs);
    return { exitCode: 0, line: `WORK_CODEX_RELAY kind=SUCCESS code=OK transmissions=${result.relay.completedTransmissions} cleanup=${result.cleanup}` };
  } catch (error) {
    const code = error instanceof RelayConfigError || error instanceof RelayFailure ? error.code : "CLI_INTERNAL_ERROR";
    return failure(code);
  }
}

async function main(): Promise<void> {
  const outcome = await runPortableCli(process.argv.slice(2));
  process.stdout.write(`${outcome.line}\n`);
  process.exitCode = outcome.exitCode;
}

if (process.argv[1]?.endsWith("portable-cli.js")) {
  void main().catch(() => {
    process.stdout.write("WORK_CODEX_RELAY kind=FAILURE code=CLI_INTERNAL_ERROR transmissions=0 cleanup=NOT_CONFIRMED\n");
    process.exitCode = 1;
  });
}
