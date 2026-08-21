import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { buildUpdateFeedUrl, compareVersions, evaluateUpdatePolicy, isOfficialUpdateFeedUrl, UpdaterController, validateUpdateManifest, verifyArtifactHash, type ElectronUpdaterAdapter } from "../desktop/updater.js";

class FakeUpdater implements ElectronUpdaterAdapter {
  feedUrl = "";
  checks = 0;
  installs = 0;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  setFeedURL(options: { url: string }): void { this.feedUrl = options.url; }
  checkForUpdates(): void { this.checks += 1; }
  quitAndInstall(): void { this.installs += 1; }
  on(event: string, listener: (...args: unknown[]) => void): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  removeListener(event: string, listener: (...args: unknown[]) => void): void { this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener)); }
  emit(event: string, ...args: unknown[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
}

test("update policy fails closed for unsigned, development, wrong-source and wrong-publisher builds", () => {
  const base = { packaged: true, platform: "win32", architecture: "x64", currentVersion: "1.0.0-rc.4", channel: "preview" as const, signatureState: "SIGNED" as const, publisher: "ChatCOM", timestamped: true, repository: "NoisyBoyFR/ChatCOM", minimumUpdaterVersion: "1.0.0" };
  assert.deepEqual(evaluateUpdatePolicy({ ...base, signatureState: "UNSIGNED" }), { enabled: false, reason: "SIGNATURE_REQUIRED" });
  assert.deepEqual(evaluateUpdatePolicy({ ...base, packaged: false }), { enabled: false, reason: "DEVELOPMENT_BUILD" });
  assert.deepEqual(evaluateUpdatePolicy({ ...base, repository: "other/repo" }), { enabled: false, reason: "UPDATE_SOURCE_INVALID" });
  assert.deepEqual(evaluateUpdatePolicy({ ...base, publisher: "Other" }), { enabled: false, reason: "PUBLISHER_INVALID" });
  assert.deepEqual(evaluateUpdatePolicy(base), { enabled: true, reason: "READY" });
});

test("version ordering rejects downgrades and constructs the official feed", () => {
  assert.equal(compareVersions("1.0.0-rc.5", "1.0.0-rc.4"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.3", "1.0.0-rc.4"), -1);
  assert.equal(buildUpdateFeedUrl("1.0.0-rc.4"), "https://update.electronjs.org/NoisyBoyFR/ChatCOM/win32-x64/1.0.0-rc.4");
  assert.equal(isOfficialUpdateFeedUrl(buildUpdateFeedUrl("1.0.0-rc.4"), "1.0.0-rc.4"), true);
  assert.equal(isOfficialUpdateFeedUrl("http://update.electronjs.org/NoisyBoyFR/ChatCOM/win32-x64/1.0.0-rc.4", "1.0.0-rc.4"), false);
  const preview = buildUpdateFeedUrl("1.0.0-rc.4", "preview");
  assert.match(preview, /noisyboyfr\.github\.io\/ChatCOM\/updates\/preview\/win32\/x64/u);
  assert.equal(isOfficialUpdateFeedUrl(preview, "1.0.0-rc.4", "preview"), true);
});

test("manifest validation requires the exact signed Windows Squirrel artifact set", () => {
  const manifest = { version: "1.0.0-rc.5", channel: "preview", platform: "windows", architecture: "x64", publisher: "ChatCOM", timestamped: true, minimumUpdaterVersion: "1.0.0", signatureState: "SIGNED", artifacts: [
    { filename: "ChatCOM-Setup.exe", size: 10, sha256: "a".repeat(64), kind: "setup" },
    { filename: "chatcom-full.nupkg", size: 20, sha256: "b".repeat(64), kind: "squirrel-full" },
    { filename: "RELEASES", size: 30, sha256: "c".repeat(64), kind: "squirrel-releases" },
  ] };
  assert.deepEqual(validateUpdateManifest(manifest, { currentVersion: "1.0.0-rc.4", channel: "preview" }), { enabled: true, reason: "READY" });
  assert.deepEqual(validateUpdateManifest({ ...manifest, signatureState: "UNSIGNED" }, { currentVersion: "1.0.0-rc.4", channel: "preview" }), { enabled: false, reason: "SIGNATURE_INVALID" });
  assert.deepEqual(validateUpdateManifest({ ...manifest, artifacts: manifest.artifacts.slice(0, 2) }, { currentVersion: "1.0.0-rc.4", channel: "preview" }), { enabled: false, reason: "ARTIFACT_SET_INVALID" });
  assert.deepEqual(validateUpdateManifest({ ...manifest, version: "1.0.0-rc.3" }, { currentVersion: "1.0.0-rc.4", channel: "preview" }), { enabled: false, reason: "VERSION_NOT_NEWER" });
});

test("artifact hashes are verified before an update is admitted", async () => {
  const file = resolve("package.json");
  const expected = createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(file))).digest("hex");
  assert.equal(await verifyArtifactHash(file, expected), true);
  assert.equal(await verifyArtifactHash(file, "0".repeat(64)), false);
});

test("updater delays startup, serializes checks, waits for clean relay state, and never forces restart", async () => {
  const adapter = new FakeUpdater();
  let delayed: (() => void) | undefined;
  let relay: { activity: "IDLE" | "RUNNING"; cleanupConfirmed: boolean } = { activity: "IDLE", cleanupConfirmed: true };
  const manifest = { version: "1.0.0-rc.5", channel: "preview", platform: "windows", architecture: "x64", publisher: "ChatCOM", timestamped: true, minimumUpdaterVersion: "1.0.0", signatureState: "SIGNED", artifacts: [{ filename: "Setup.exe", size: 1, sha256: "a".repeat(64), kind: "setup" }, { filename: "full.nupkg", size: 1, sha256: "b".repeat(64), kind: "squirrel-full" }, { filename: "RELEASES", size: 1, sha256: "c".repeat(64), kind: "squirrel-releases" }] };
  const controller = new UpdaterController({ adapter, currentVersion: "1.0.0-rc.4", channel: "preview", publicUpdatesEnabled: true, feedUrl: "http://127.0.0.1:43127/preview/win32/x64", allowLocalhostFeed: true, loadManifest: async () => manifest, startDelayMs: 10_000, intervalMs: 21600000, setTimeout: (handler) => { delayed = handler; return 1 as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: () => undefined, setInterval: () => 2 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined, relayState: () => relay });
  controller.start();
  assert.equal(adapter.checks, 0);
  delayed?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.checks, 1);
  assert.match(adapter.feedUrl, /127\.0\.0\.1:43127\/preview\/win32\/x64/u);
  relay = { activity: "RUNNING", cleanupConfirmed: false };
  adapter.emit("update-downloaded", {}, "safe notes", "ChatCOM Desktop 1.0.0-rc.5", new Date("2026-08-21T00:00:00.000Z"), "http://127.0.0.1:43127/preview/win32/x64");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.snapshot().status, "READY");
  assert.equal(controller.snapshot().readyToInstall, false);
  assert.throws(() => controller.restartAndInstall(), /UPDATE_RESTART_BLOCKED/u);
  relay = { activity: "IDLE", cleanupConfirmed: true };
  controller.setRelayState("IDLE", true);
  assert.equal(controller.snapshot().readyToInstall, true);
  controller.restartAndInstall();
  assert.equal(adapter.installs, 1);
  adapter.emit("update-downloaded", {}, "", "ChatCOM Desktop 1.0.0-rc.3", new Date("2026-08-21T00:00:00.000Z"), "http://127.0.0.1:43127/preview/win32/x64");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.snapshot().errorCode, "DOWNGRADE_REJECTED");
  controller.stop();
});

test("update-downloaded without complete official metadata never reaches READY", async () => {
  const adapter = new FakeUpdater();
  const controller = new UpdaterController({ adapter, currentVersion: "1.0.0-rc.4", channel: "stable", publicUpdatesEnabled: true, policyEnabled: true, loadManifest: async () => ({}), relayState: () => ({ activity: "IDLE", cleanupConfirmed: true }) });
  controller.start();
  adapter.emit("update-downloaded", {}, "notes", undefined, new Date("2026-08-21T00:00:00.000Z"), "https://update.electronjs.org/NoisyBoyFR/ChatCOM/win32-x64/1.0.0-rc.4");
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(controller.snapshot().status, "READY");
  assert.equal(controller.snapshot().errorCode, "RELEASE_METADATA_INVALID");
  controller.stop();
});

test("disabled or unsigned update checks never contact the updater", async () => {
  const adapter = new FakeUpdater();
  const controller = new UpdaterController({ adapter, currentVersion: "1.0.0-rc.4", channel: "preview", publicUpdatesEnabled: false, policyEnabled: false });
  const snapshot = await controller.checkNow();
  assert.equal(snapshot.status, "DISABLED");
  assert.equal(adapter.checks, 0);
});
