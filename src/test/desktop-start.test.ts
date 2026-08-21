import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DesktopStartCoordinator, isDesktopStartEnabled } from "../desktop/start-policy.js";

test("desktop Start is enabled from IDLE or READY only after a successful preflight", () => {
  assert.equal(isDesktopStartEnabled(undefined, true), false);
  assert.equal(isDesktopStartEnabled("IDLE", false), false);
  assert.equal(isDesktopStartEnabled("IDLE", true), true);
  assert.equal(isDesktopStartEnabled("READY", true), true);
  for (const state of ["RUNNING", "PAUSE_REQUESTED", "STOPPING", "CONFIGURING", "USER_DECISION_REQUIRED", "PAUSED", "STOPPED", "COMPLETED", "FAILED"] as const) {
    assert.equal(isDesktopStartEnabled(state, true), false, state);
  }
  assert.equal(isDesktopStartEnabled("IDLE", true, true), false);
});

test("desktop Start coordinates configure then start exactly once under rapid activation", async () => {
  const coordinator = new DesktopStartCoordinator();
  let configureCalls = 0;
  let startCalls = 0;
  let releaseAction!: () => void;
  const first = coordinator.activate(async () => {
    configureCalls += 1;
    await new Promise<void>((resolve) => { releaseAction = resolve; });
    startCalls += 1;
  });
  assert.equal(coordinator.busy, true);
  assert.equal(await coordinator.activate(async () => { configureCalls += 1; }), false);
  releaseAction();
  assert.equal(await first, true);
  assert.deepEqual({ configureCalls, startCalls }, { configureCalls: 1, startCalls: 1 });
  assert.equal(coordinator.busy, true);
  coordinator.release();
  assert.equal(coordinator.busy, false);
});

test("desktop Start coordinator releases its guard after a failed IPC sequence", async () => {
  const coordinator = new DesktopStartCoordinator();
  await assert.rejects(coordinator.activate(async () => { throw new Error("fixture"); }), /fixture/u);
  assert.equal(coordinator.busy, false);
});

test("renderer centralizes the Start rule and keeps the preflight path model-free", async () => {
  const renderer = await readFile("apps/desktop/renderer/renderer.ts", "utf8");
  assert.match(renderer, /isDesktopStartEnabled\(snapshot\?\.state, preflight\?\.canStart === true, startCoordinator\.busy\)/u);
  assert.equal((renderer.match(/renderStartButton\(\);/gu) ?? []).length >= 3, true);
  assert.equal((renderer.match(/window\.chatcomDesktop\.configure\(/gu) ?? []).length, 1);
  assert.equal((renderer.match(/window\.chatcomDesktop\.start\(\)/gu) ?? []).length, 1);
  assert.match(renderer, /startCoordinator\.activate\(/u);
  assert.match(renderer, /timeline\.replaceChildren\(\)/u);
});

test("the packaged Start smoke stops after preflight and never clicks Start", async () => {
  const smoke = await readFile("scripts/desktop-start-preflight-smoke.mjs", "utf8");
  assert.match(smoke, /#verify-config.*click\(\)/u);
  assert.match(smoke, /START_PREFLIGHT_SMOKE kind=SUCCESS/u);
  assert.match(smoke, /relay=NOT_STARTED/u);
  assert.doesNotMatch(smoke, /querySelector\('#start'\)\.click/u);
});
