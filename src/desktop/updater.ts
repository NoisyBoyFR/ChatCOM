import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export const CHATCOM_UPDATE_SERVER = "https://update.electronjs.org";
export const CHATCOM_UPDATE_REPOSITORY = "NoisyBoyFR/ChatCOM";
export const CHATCOM_PREVIEW_UPDATE_BASE_URL = "https://noisyboyfr.github.io/ChatCOM/updates";
export const CHATCOM_PRODUCT_NAME = "ChatCOM";
export const UPDATE_START_DELAY_MS = 10_000;
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export type UpdateChannel = "stable" | "preview";
export type UpdateStatus = "DISABLED" | "IDLE" | "CHECKING" | "DOWNLOADING" | "READY" | "NO_UPDATE" | "ERROR";
export type RelayActivity = "IDLE" | "RUNNING" | "PAUSE_REQUESTED" | "STOPPING";

export interface UpdateSnapshot {
  status: UpdateStatus;
  currentVersion: string;
  channel: UpdateChannel;
  availableVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  readyToInstall: boolean;
  publicUpdatesEnabled: boolean;
  errorCode?: string;
}

export interface UpdatePolicyInput {
  packaged: boolean;
  platform: string;
  architecture: string;
  currentVersion: string;
  channel: UpdateChannel;
  signatureState: "SIGNED" | "UNSIGNED" | "INVALID";
  publisher: string;
  timestamped: boolean;
  repository: string;
  minimumUpdaterVersion: string;
}

export interface UpdatePolicyResult {
  enabled: boolean;
  reason: string;
}

export interface AuthenticodeProof {
  signatureState: "SIGNED" | "UNSIGNED" | "INVALID";
  publisher: string;
  timestamped: boolean;
}

export interface UpdateArtifact {
  filename: string;
  size: number;
  sha256: string;
  kind: "setup" | "squirrel-full" | "squirrel-releases";
}

export interface UpdateManifest {
  version: string;
  channel: UpdateChannel;
  platform: "windows";
  architecture: "x64";
  publisher: string;
  timestamped: boolean;
  minimumUpdaterVersion: string;
  signatureState: "SIGNED" | "UNSIGNED" | "INVALID";
  artifacts: UpdateArtifact[];
}

export interface ElectronUpdaterAdapter {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void | Promise<unknown>;
  quitAndInstall(): void;
  on(event: "checking-for-update" | "update-available" | "update-not-available" | "update-downloaded" | "error" | "before-quit-for-update", listener: (...args: unknown[]) => void): void;
  removeListener(event: "checking-for-update" | "update-available" | "update-not-available" | "update-downloaded" | "error" | "before-quit-for-update", listener: (...args: unknown[]) => void): void;
}

export interface UpdaterControllerOptions {
  adapter: ElectronUpdaterAdapter;
  currentVersion: string;
  channel: UpdateChannel;
  publicUpdatesEnabled: boolean;
  policyEnabled?: boolean;
  feedUrl?: string;
  allowLocalhostFeed?: boolean;
  loadManifest?: (updateURL: string, expected: { currentVersion: string; channel: UpdateChannel; releaseVersion: string }) => Promise<unknown>;
  startDelayMs?: number;
  intervalMs?: number;
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
  setInterval?: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  relayState?: () => { activity: RelayActivity; cleanupConfirmed: boolean };
  onChange?: (snapshot: UpdateSnapshot) => void;
}

function versionParts(value: string): { core: number[]; pre: string[] } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(value);
  if (!match) return undefined;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] };
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (a.pre.length > 0 && b.pre.length === 0) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const av = a.pre[index];
    const bv = b.pre[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/u.test(av);
    const bn = /^\d+$/u.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function defaultUpdateChannel(version: string): UpdateChannel {
  return versionParts(version)?.pre.length ? "preview" : "stable";
}

function extractVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u.exec(value);
  return match && versionParts(match[0]) ? match[0] : undefined;
}

const MAX_PUBLISHER_SUBJECT_LENGTH = 512;

function normalizePublisherSubject(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.replace(/[\r\n\t]+/gu, " ").trim();
  if (normalized.length === 0 || normalized.length > MAX_PUBLISHER_SUBJECT_LENGTH || normalized === "UNKNOWN" || normalized === "UNAVAILABLE") return "UNKNOWN";
  return normalized;
}

function hasConfiguredPublisherSubject(value: unknown): value is string {
  return normalizePublisherSubject(value) !== "UNKNOWN";
}

export function buildUpdateFeedUrl(currentVersion: string, channel: UpdateChannel = "stable", previewBaseUrl = CHATCOM_PREVIEW_UPDATE_BASE_URL): string {
  if (channel === "preview") return `${previewBaseUrl.replace(/\/$/u, "")}/preview/win32/x64`;
  return `${CHATCOM_UPDATE_SERVER}/${CHATCOM_UPDATE_REPOSITORY}/win32-x64/${encodeURIComponent(currentVersion)}`;
}

export function evaluateUpdatePolicy(input: UpdatePolicyInput): UpdatePolicyResult {
  if (!input.packaged) return { enabled: false, reason: "DEVELOPMENT_BUILD" };
  if (input.platform !== "win32" || input.architecture !== "x64") return { enabled: false, reason: "PLATFORM_UNSUPPORTED" };
  if (input.signatureState !== "SIGNED") return { enabled: false, reason: "SIGNATURE_REQUIRED" };
  if (!input.timestamped) return { enabled: false, reason: "SIGNATURE_TIMESTAMP_REQUIRED" };
  if (!hasConfiguredPublisherSubject(input.publisher)) return { enabled: false, reason: "PUBLISHER_INVALID" };
  if (input.repository !== CHATCOM_UPDATE_REPOSITORY) return { enabled: false, reason: "UPDATE_SOURCE_INVALID" };
  if (!versionParts(input.currentVersion) || !versionParts(input.minimumUpdaterVersion)) return { enabled: false, reason: "VERSION_INVALID" };
  return { enabled: true, reason: "READY" };
}

export function isOfficialUpdateFeedUrl(value: string, currentVersion: string, channel: UpdateChannel = "stable", previewBaseUrl = CHATCOM_PREVIEW_UPDATE_BASE_URL, allowLocalhost = false): boolean {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
    if (channel === "stable") return url.protocol === "https:" && url.hostname === "update.electronjs.org" && url.pathname === `/${CHATCOM_UPDATE_REPOSITORY}/win32-x64/${encodeURIComponent(currentVersion)}`;
    const expected = new URL(`${previewBaseUrl.replace(/\/$/u, "")}/preview/win32/x64`);
    const localhost = allowLocalhost && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return localhost ? url.protocol === "http:" && url.pathname === "/preview/win32/x64" : url.protocol === "https:" && url.hostname === expected.hostname && url.pathname === expected.pathname;
  } catch { return false; }
}

export function validateUpdateManifest(raw: unknown, expected: { currentVersion: string; channel: UpdateChannel }): UpdatePolicyResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { enabled: false, reason: "MANIFEST_INVALID" };
  const manifest = raw as Partial<UpdateManifest>;
  if (manifest.platform !== "windows" || manifest.architecture !== "x64") return { enabled: false, reason: "PLATFORM_MISMATCH" };
  if (manifest.channel !== expected.channel) return { enabled: false, reason: "CHANNEL_MISMATCH" };
  if (typeof manifest.version !== "string" || compareVersions(manifest.version, expected.currentVersion) <= 0) return { enabled: false, reason: "VERSION_NOT_NEWER" };
  if (manifest.signatureState !== "SIGNED" || !hasConfiguredPublisherSubject(manifest.publisher) || manifest.timestamped !== true) return { enabled: false, reason: "SIGNATURE_INVALID" };
  if (typeof manifest.minimumUpdaterVersion !== "string" || compareVersions(manifest.minimumUpdaterVersion, "1.0.0") > 0) return { enabled: false, reason: "UPDATER_TOO_OLD" };
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) return { enabled: false, reason: "ARTIFACT_SET_INVALID" };
  const kinds = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (typeof artifact !== "object" || artifact === null || typeof artifact.filename !== "string" || artifact.filename.includes("/") || artifact.filename.includes("\\") || typeof artifact.size !== "number" || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256) || !["setup", "squirrel-full", "squirrel-releases"].includes(artifact.kind)) return { enabled: false, reason: "ARTIFACT_INVALID" };
    kinds.add(artifact.kind);
  }
  if (kinds.size !== 3) return { enabled: false, reason: "ARTIFACT_SET_INVALID" };
  return { enabled: true, reason: "READY" };
}

export async function verifyArtifactHash(filePath: string, expectedSha256: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) return false;
  try { return createHash("sha256").update(await readFile(filePath)).digest("hex") === expectedSha256; }
  catch { return false; }
}

export function inspectWindowsAuthenticode(filePath: string): Promise<AuthenticodeProof> {
  if (process.platform !== "win32") return Promise.resolve({ signatureState: "INVALID", publisher: "UNAVAILABLE", timestamped: false });
  const script = "$s=Get-AuthenticodeSignature -LiteralPath $args[0]; $publisher=if ($s.SignerCertificate) {[string]$s.SignerCertificate.Subject} else {$null}; [pscustomobject]@{Status=[string]$s.Status;Publisher=$publisher;Timestamped=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, filePath], { windowsHide: true, timeout: 5_000, maxBuffer: 8_192 }, (_error, stdout) => {
      try {
        const result = JSON.parse(stdout) as { Status?: unknown; Publisher?: unknown; Timestamped?: unknown };
        resolve({ signatureState: result.Status === "Valid" ? "SIGNED" : result.Status === "NotSigned" ? "UNSIGNED" : "INVALID", publisher: normalizePublisherSubject(result.Publisher), timestamped: result.Timestamped === true });
      } catch { resolve({ signatureState: "INVALID", publisher: "UNKNOWN", timestamped: false }); }
    });
  });
}

export class UpdaterController {
  private readonly adapter: ElectronUpdaterAdapter;
  private readonly startDelayMs: number;
  private readonly intervalMs: number;
  private readonly setTimeoutFn: NonNullable<UpdaterControllerOptions["setTimeout"]>;
  private readonly clearTimeoutFn: NonNullable<UpdaterControllerOptions["clearTimeout"]>;
  private readonly setIntervalFn: NonNullable<UpdaterControllerOptions["setInterval"]>;
  private readonly clearIntervalFn: NonNullable<UpdaterControllerOptions["clearInterval"]>;
  private readonly relayState: () => { activity: RelayActivity; cleanupConfirmed: boolean };
  private readonly onChange?: (snapshot: UpdateSnapshot) => void;
  private readonly policyEnabled: boolean;
  private readonly feedUrl?: string;
  private readonly allowLocalhostFeed: boolean;
  private readonly loadManifest?: UpdaterControllerOptions["loadManifest"];
  private readonly listeners = new Map<string, (...args: unknown[]) => void>();
  private startTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  private checking = false;
  private relayActivity: RelayActivity = "IDLE";
  private cleanupConfirmed = true;
  private snapshotState: UpdateSnapshot;

  constructor(options: UpdaterControllerOptions) {
    this.adapter = options.adapter;
    this.startDelayMs = options.startDelayMs ?? UPDATE_START_DELAY_MS;
    this.intervalMs = options.intervalMs ?? UPDATE_INTERVAL_MS;
    this.setTimeoutFn = options.setTimeout ?? ((handler, timeout) => globalThis.setTimeout(handler, timeout));
    this.clearTimeoutFn = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
    this.setIntervalFn = options.setInterval ?? ((handler, timeout) => globalThis.setInterval(handler, timeout));
    this.clearIntervalFn = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle));
    this.relayState = options.relayState ?? (() => ({ activity: this.relayActivity, cleanupConfirmed: this.cleanupConfirmed }));
    this.onChange = options.onChange;
    this.policyEnabled = options.policyEnabled ?? options.publicUpdatesEnabled;
    this.feedUrl = options.feedUrl;
    this.allowLocalhostFeed = options.allowLocalhostFeed ?? false;
    this.loadManifest = options.loadManifest;
    this.snapshotState = { status: options.publicUpdatesEnabled ? "IDLE" : "DISABLED", currentVersion: options.currentVersion, channel: options.channel, readyToInstall: false, publicUpdatesEnabled: options.publicUpdatesEnabled };
  }

  start(): void {
    if (!this.snapshotState.publicUpdatesEnabled || this.startTimer !== undefined) return;
    this.attachListeners();
    this.startTimer = this.setTimeoutFn(() => {
      this.startTimer = undefined;
      void this.checkNow();
      this.intervalTimer = this.setIntervalFn(() => { void this.checkNow(); }, this.intervalMs);
    }, this.startDelayMs);
  }

  stop(): void {
    if (this.startTimer !== undefined) this.clearTimeoutFn(this.startTimer);
    if (this.intervalTimer !== undefined) this.clearIntervalFn(this.intervalTimer);
    this.startTimer = undefined;
    this.intervalTimer = undefined;
    for (const [event, listener] of this.listeners) this.adapter.removeListener(event as Parameters<ElectronUpdaterAdapter["removeListener"]>[0], listener);
    this.listeners.clear();
  }

  setEnabled(enabled: boolean): void {
    const active = enabled && this.policyEnabled;
    this.publish({ publicUpdatesEnabled: active, status: active ? "IDLE" : "DISABLED", readyToInstall: false, errorCode: active ? undefined : "SIGNATURE_REQUIRED" });
    if (active) this.start();
    else this.stop();
  }

  setChannel(channel: UpdateChannel): void { this.publish({ channel }); }

  async checkNow(): Promise<UpdateSnapshot> {
    if (!this.snapshotState.publicUpdatesEnabled) return this.publish({ status: "DISABLED", errorCode: "SIGNATURE_REQUIRED" });
    if (this.checking) return this.snapshot();
    this.checking = true;
    this.publish({ status: "CHECKING", readyToInstall: false, errorCode: undefined });
    try {
      const feed = this.feedUrl ?? buildUpdateFeedUrl(this.snapshotState.currentVersion, this.snapshotState.channel);
      if (!isOfficialUpdateFeedUrl(feed, this.snapshotState.currentVersion, this.snapshotState.channel, CHATCOM_PREVIEW_UPDATE_BASE_URL, this.allowLocalhostFeed)) throw new Error("UPDATE_SOURCE_INVALID");
      this.adapter.setFeedURL({ url: feed });
      await this.adapter.checkForUpdates();
    }
    catch { this.publish({ status: "ERROR", readyToInstall: false, errorCode: "UPDATE_CHECK_FAILED" }); }
    finally { this.checking = false; }
    return this.snapshot();
  }

  setRelayState(activity: RelayActivity, cleanupConfirmed: boolean): void {
    this.relayActivity = activity;
    this.cleanupConfirmed = cleanupConfirmed;
    this.recomputeReady();
  }

  restartAndInstall(): void {
    const relay = this.relayState();
    if (relay.activity !== "IDLE" || !relay.cleanupConfirmed || !this.snapshotState.readyToInstall) throw new Error("UPDATE_RESTART_BLOCKED");
    this.adapter.quitAndInstall();
  }

  snapshot(): UpdateSnapshot { return { ...this.snapshotState }; }

  private attachListeners(): void {
    const bind = (event: Parameters<ElectronUpdaterAdapter["on"]>[0], handler: (...args: unknown[]) => void): void => { this.listeners.set(event, handler); this.adapter.on(event, handler); };
    bind("checking-for-update", () => this.publish({ status: "CHECKING", readyToInstall: false, errorCode: undefined }));
    bind("update-available", () => this.publish({ status: "DOWNLOADING", readyToInstall: false, errorCode: undefined }));
    bind("update-not-available", () => this.publish({ status: "NO_UPDATE", readyToInstall: false, errorCode: undefined, availableVersion: undefined }));
    bind("update-downloaded", (...args) => {
      const releaseNotes = typeof args[1] === "string" ? args[1].slice(0, 4_096) : undefined;
      const availableVersion = extractVersion(args[2]);
      const releaseDate = args[3] instanceof Date && !Number.isNaN(args[3].getTime()) ? args[3].toISOString() : undefined;
      const updateURL = typeof args[4] === "string" ? args[4] : undefined;
      if (!availableVersion || !releaseDate || !updateURL) return this.publish({ status: "ERROR", readyToInstall: false, errorCode: "RELEASE_METADATA_INVALID" });
      if (compareVersions(availableVersion, this.snapshotState.currentVersion) <= 0) return this.publish({ status: "NO_UPDATE", readyToInstall: false, errorCode: "DOWNGRADE_REJECTED" });
      if (this.snapshotState.channel === "stable" && defaultUpdateChannel(availableVersion) === "preview") return this.publish({ status: "NO_UPDATE", readyToInstall: false, errorCode: "CHANNEL_MISMATCH" });
      if (!isOfficialUpdateFeedUrl(this.feedUrl ?? buildUpdateFeedUrl(this.snapshotState.currentVersion, this.snapshotState.channel), this.snapshotState.currentVersion, this.snapshotState.channel, CHATCOM_PREVIEW_UPDATE_BASE_URL, this.allowLocalhostFeed)) return this.publish({ status: "ERROR", readyToInstall: false, errorCode: "UPDATE_SOURCE_INVALID" });
      const load = this.loadManifest;
      if (!load) return this.publish({ status: "ERROR", readyToInstall: false, errorCode: "MANIFEST_REQUIRED" });
      void load(updateURL, { currentVersion: this.snapshotState.currentVersion, channel: this.snapshotState.channel, releaseVersion: availableVersion }).then((manifest) => {
        const validation = validateUpdateManifest(manifest, { currentVersion: this.snapshotState.currentVersion, channel: this.snapshotState.channel });
        if (!validation.enabled || (manifest as { version?: unknown }).version !== availableVersion) { this.publish({ status: "ERROR", readyToInstall: false, errorCode: validation.reason }); return; }
        this.publish({ status: "READY", readyToInstall: false, availableVersion, releaseNotes, releaseDate, errorCode: undefined });
        this.recomputeReady();
      }).catch(() => { this.publish({ status: "ERROR", readyToInstall: false, errorCode: "MANIFEST_FETCH_FAILED" }); });
    });
    bind("error", () => this.publish({ status: "ERROR", readyToInstall: false, errorCode: "UPDATE_RUNTIME_FAILED" }));
    bind("before-quit-for-update", () => this.publish({ status: "READY" }));
  }

  private recomputeReady(): void {
    const readyToInstall = this.snapshotState.status === "READY" && this.relayState().activity === "IDLE" && this.relayState().cleanupConfirmed;
    this.publish({ readyToInstall });
  }

  private publish(patch: Partial<UpdateSnapshot>): UpdateSnapshot {
    this.snapshotState = { ...this.snapshotState, ...patch };
    this.onChange?.(this.snapshot());
    return this.snapshot();
  }
}
