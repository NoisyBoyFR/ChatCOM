import { createHash } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const valueFor = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const setupPath = valueFor("--setup");
const appPath = valueFor("--app");
const manifestPath = valueFor("--manifest");
const sumsPath = valueFor("--sums");
const expectedRuntimeVersion = "0.149.0";

if (!setupPath || !appPath || (args.length !== 4 && args.length !== 8)) {
  console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=USAGE_INVALID");
  process.exitCode = 1;
} else {
  try {
    const setup = resolve(setupPath);
    const app = resolve(appPath);
    const setupStats = await stat(setup);
    if (!setupStats.isFile() || setupStats.size < 1_000_000) throw new Error("setup");
    await access(resolve(app, "resources", "app.asar"));
    const runtimePackage = resolve(app, "resources", "@openai", "codex-win32-x64");
    const packageMetadata = JSON.parse(await readFile(resolve(runtimePackage, "package.json"), "utf8"));
    if (typeof packageMetadata.version !== "string" || !(packageMetadata.version === expectedRuntimeVersion || packageMetadata.version.startsWith(`${expectedRuntimeVersion}-`))) throw new Error("runtime-version");
    const runtime = resolve(runtimePackage, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    await access(runtime);
    const versionProbe = spawnSync(runtime, ["--version"], { shell: false, windowsHide: true, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
    if (versionProbe.status !== 0 || !new RegExp(`\\b${expectedRuntimeVersion.replaceAll(".", "\\.")}(?:-[A-Za-z0-9.-]+)?\\b`, "u").test(`${versionProbe.stdout ?? ""}`)) throw new Error("runtime-executable");
    const runtimeStats = await stat(runtime);
    const setupHash = createHash("sha256");
    const { createReadStream } = await import("node:fs");
    await new Promise((resolvePromise, reject) => { const stream = createReadStream(setup); stream.on("data", (chunk) => setupHash.update(chunk)); stream.on("error", reject); stream.on("end", resolvePromise); });
    const setupSha256 = setupHash.digest("hex");
    const runtimeSha256 = createHash("sha256").update(await readFile(runtime)).digest("hex");
    const filename = basename(setup);
    if (manifestPath || sumsPath) {
      if (!manifestPath || !sumsPath) throw new Error("artifact-output");
      const manifest = { version: "1.0.0-rc.3", platform: "windows", architecture: "x64", filename, size: setupStats.size, sha256: setupSha256, codexRuntimeVersion: expectedRuntimeVersion, signature: "UNSIGNED" };
      await writeFile(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(resolve(sumsPath), `${setupSha256}  ${filename}\n`, "utf8");
    }
    console.log(`CHATCOM_DESKTOP_PACKAGE kind=VALID setup_bytes=${setupStats.size} sha256=${setupSha256} runtime=FOUND`);
    console.log(`CHATCOM_DESKTOP_MANIFEST version=${packageMetadata.version} architecture=x64 setup_bytes=${setupStats.size} setup_sha256=${setupSha256} runtime_bytes=${runtimeStats.size} runtime_sha256=${runtimeSha256}`);
  } catch {
    console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=PACKAGE_INVALID");
    process.exitCode = 1;
  }
}
