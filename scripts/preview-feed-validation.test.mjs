import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function digest(value) { return createHash("sha256").update(value).digest("hex"); }

test("preview feed validation requires signed timestamped artifacts and verifies hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "chatcom-preview-feed-"));
  try {
    const setup = Buffer.from("synthetic setup");
    const nupkg = Buffer.from("synthetic full package");
    const releases = Buffer.from("synthetic releases");
    await writeFile(join(root, "ChatCOM-Desktop-1.0.0-rc.5-Setup.exe"), setup);
    await writeFile(join(root, "ChatCOM-Desktop-1.0.0-rc.5-full.nupkg"), nupkg);
    await writeFile(join(root, "RELEASES"), releases);
    const manifest = {
      version: "1.0.0-rc.5", channel: "preview", platform: "windows", architecture: "x64",
      publisher: "CN=Approved Test Publisher", approvedPublisherSubject: "CN=Approved Test Publisher", timestamped: true, signature: "SIGNED", signatureState: "SIGNED",
      artifacts: [
        { filename: "ChatCOM-Desktop-1.0.0-rc.5-Setup.exe", size: setup.length, sha256: digest(setup), kind: "setup" },
        { filename: "ChatCOM-Desktop-1.0.0-rc.5-full.nupkg", size: nupkg.length, sha256: digest(nupkg), kind: "squirrel-full" },
        { filename: "RELEASES", size: releases.length, sha256: digest(releases), kind: "squirrel-releases" },
      ],
    };
    const manifestPath = join(root, "desktop-build-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const script = join(process.cwd(), "scripts", "validate-preview-feed.mjs");
    const valid = spawnSync(process.execPath, [script, "--root", root, "--manifest", manifestPath], { encoding: "utf8" });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /CHATCOM_PREVIEW_FEED kind=VALID version=1\.0\.0-rc\.5 signature=SIGNED artifacts=3 publisher=CONFIGURED/u);

    const unsignedPath = join(root, "unsigned.json");
    await writeFile(unsignedPath, JSON.stringify({ ...manifest, signature: "UNSIGNED", signatureState: "UNSIGNED" }));
    const unsigned = spawnSync(process.execPath, [script, "--root", root, "--manifest", unsignedPath], { encoding: "utf8" });
    assert.notEqual(unsigned.status, 0);
    assert.match(unsigned.stdout, /CHATCOM_PREVIEW_FEED kind=FAILURE code=PREVIEW_FEED_INVALID/u);

    const unknownPublisherPath = join(root, "unknown-publisher.json");
    await writeFile(unknownPublisherPath, JSON.stringify({ ...manifest, publisher: "UNKNOWN" }));
    const unknownPublisher = spawnSync(process.execPath, [script, "--root", root, "--manifest", unknownPublisherPath], { encoding: "utf8" });
    assert.notEqual(unknownPublisher.status, 0);
    assert.match(unknownPublisher.stdout, /CHATCOM_PREVIEW_FEED kind=FAILURE code=PREVIEW_FEED_INVALID/u);

    const differentPublisherPath = join(root, "different-publisher.json");
    await writeFile(differentPublisherPath, JSON.stringify({ ...manifest, publisher: "CN=Other Publisher" }));
    const differentPublisher = spawnSync(process.execPath, [script, "--root", root, "--manifest", differentPublisherPath], { encoding: "utf8" });
    assert.notEqual(differentPublisher.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
