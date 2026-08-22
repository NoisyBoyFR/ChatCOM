import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UpdaterController, validateUpdateManifest, verifyArtifactHash } from "../dist/desktop/updater.js";

class SyntheticAdapter {
  feedUrl = "";
  checks = 0;
  installs = 0;
  listeners = new Map();
  setFeedURL(options) { this.feedUrl = options.url; }
  checkForUpdates() { this.checks += 1; }
  quitAndInstall() { this.installs += 1; }
  on(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  removeListener(event, listener) { this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener)); }
  emit(event, ...args) { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
}

test("synthetic localhost Squirrel feed upgrades RC.5 to RC.6-test and preserves the guarded restart", async () => {
  const temp = await mkdtemp(join(tmpdir(), "chatcom-upgrade-"));
  const nupkg = Buffer.from("ChatCOM RC.6-test full package");
  const nupkgSha256 = createHash("sha256").update(nupkg).digest("hex");
  const manifest = { version: "1.0.0-rc.6-test", channel: "preview", platform: "windows", architecture: "x64", publisher: "CN=Approved Test Publisher", approvedPublisherSubject: "CN=Approved Test Publisher", timestamped: true, minimumUpdaterVersion: "1.0.0", signatureState: "SIGNED", artifacts: [{ filename: "chatcom-1.0.0-rc6-test-full.nupkg", size: nupkg.length, sha256: nupkgSha256, kind: "squirrel-full" }, { filename: "ChatCOM-Desktop-1.0.0-rc.6-test-Setup.exe", size: 1, sha256: "a".repeat(64), kind: "setup" }, { filename: "RELEASES", size: 1, sha256: "b".repeat(64), kind: "squirrel-releases" }] };
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/manifest.json")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(manifest)); return; }
    if (request.url?.endsWith(".nupkg")) { response.setHeader("content-type", "application/octet-stream"); response.end(nupkg); return; }
    if (request.url?.endsWith("/RELEASES")) { response.setHeader("content-type", "text/plain"); response.end(`${nupkgSha256} ${nupkg.length} chatcom-1.0.0-rc6-test-full.nupkg\n`); return; }
    response.statusCode = 404; response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/preview/win32/x64`;
  let relay = { activity: "IDLE", cleanupConfirmed: true };
  const adapter = new SyntheticAdapter();
  const controller = new UpdaterController({ adapter, currentVersion: "1.0.0-rc.5", channel: "preview", publicUpdatesEnabled: true, policyEnabled: true, approvedPublisherSubject: "CN=Approved Test Publisher", feedUrl: base, allowLocalhostFeed: true, relayState: () => relay, loadManifest: async (updateURL, expected) => { const response = await fetch(`${updateURL}/manifest.json`); const loaded = await response.json(); assert.equal(validateUpdateManifest(loaded, { currentVersion: expected.currentVersion, channel: expected.channel, approvedPublisherSubject: "CN=Approved Test Publisher" }).enabled, true); const packageResponse = await fetch(`${updateURL}/chatcom-1.0.0-rc6-test-full.nupkg`); await writeFile(join(temp, "chatcom-1.0.0-rc6-test-full.nupkg"), Buffer.from(await packageResponse.arrayBuffer())); assert.equal(await verifyArtifactHash(join(temp, "chatcom-1.0.0-rc6-test-full.nupkg"), nupkgSha256), true); return loaded; } });
  try {
    controller.start();
    await controller.checkNow();
    assert.equal(adapter.checks, 1);
    adapter.emit("update-downloaded", {}, "RC.6-test changes", "ChatCOM Desktop 1.0.0-rc.6-test", new Date("2026-08-21T00:00:00.000Z"), base);
    for (let attempt = 0; attempt < 50 && controller.snapshot().status === "CHECKING"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(controller.snapshot().status, "READY");
    relay = { activity: "RUNNING", cleanupConfirmed: false };
    controller.setRelayState("RUNNING", false);
    assert.throws(() => controller.restartAndInstall(), /UPDATE_RESTART_BLOCKED/u);
    relay = { activity: "IDLE", cleanupConfirmed: true };
    controller.setRelayState("IDLE", true);
    controller.restartAndInstall();
    assert.equal(adapter.installs, 1);
    assert.equal((await readFile(join(temp, "chatcom-1.0.0-rc6-test-full.nupkg"), "utf8")), "ChatCOM RC.6-test full package");
  } finally {
    controller.stop();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
