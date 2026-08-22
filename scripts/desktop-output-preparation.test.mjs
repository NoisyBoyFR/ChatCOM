import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("desktop output preparation cleans only a verified temporary target", async () => {
  const target = join(tmpdir(), `chatcom-output-test-${Date.now()}`);
  const script = join(process.cwd(), "scripts", "prepare-desktop-output.mjs");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "stale.marker"), "stale");
  try {
    const clean = spawnSync(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, CHATCOM_OUT_DIR: target }, encoding: "utf8" });
    assert.equal(clean.status, 0);
    assert.match(clean.stdout, /CHATCOM_DESKTOP_OUTPUT kind=READY target=VERIFIED_CLEAN/u);
    await assert.rejects(access(join(target, "stale.marker")));

    const nested = join(target, "nested");
    const rejected = spawnSync(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, CHATCOM_OUT_DIR: nested }, encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stdout, /OUTPUT_PATH_REJECTED/u);

    const source = spawnSync(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, CHATCOM_OUT_DIR: process.cwd() }, encoding: "utf8" });
    assert.notEqual(source.status, 0);
    assert.match(source.stdout, /OUTPUT_PATH_REJECTED/u);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
