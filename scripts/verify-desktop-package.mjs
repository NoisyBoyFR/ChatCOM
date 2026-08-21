import { createHash } from "node:crypto";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

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
    const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    if (typeof packageMetadata.version !== "string") throw new Error("app-version");
    const outputDirectory = dirname(setup);
    const siblingFiles = await readdir(outputDirectory);
    const nupkgName = siblingFiles.find((name) => name.endsWith("-full.nupkg"));
    const releasesName = siblingFiles.find((name) => name === "RELEASES");
    if (!nupkgName || !releasesName) throw new Error("squirrel-artifacts");
    const nupkg = resolve(outputDirectory, nupkgName);
    const releases = resolve(outputDirectory, releasesName);
    const nupkgStats = await stat(nupkg);
    const releasesStats = await stat(releases);
    if (!setupStats.isFile() || setupStats.size < 1_000_000) throw new Error("setup");
    await access(resolve(app, "resources", "app.asar"));
    const runtimePackage = resolve(app, "resources", "@openai", "codex-win32-x64");
    const runtimePackageMetadata = JSON.parse(await readFile(resolve(runtimePackage, "package.json"), "utf8"));
    if (typeof runtimePackageMetadata.version !== "string" || !(runtimePackageMetadata.version === expectedRuntimeVersion || runtimePackageMetadata.version.startsWith(`${expectedRuntimeVersion}-`))) throw new Error("runtime-version");
    const runtime = resolve(runtimePackage, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    await access(runtime);
    const versionProbe = spawnSync(runtime, ["--version"], { shell: false, windowsHide: true, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
    if (versionProbe.status !== 0 || !new RegExp(`\\b${expectedRuntimeVersion.replaceAll(".", "\\.")}(?:-[A-Za-z0-9.-]+)?\\b`, "u").test(`${versionProbe.stdout ?? ""}`)) throw new Error("runtime-executable");
    const runtimeStats = await stat(runtime);
    const setupHash = createHash("sha256");
    const { createReadStream } = await import("node:fs");
    await new Promise((resolvePromise, reject) => { const stream = createReadStream(setup); stream.on("data", (chunk) => setupHash.update(chunk)); stream.on("error", reject); stream.on("end", resolvePromise); });
    const setupSha256 = setupHash.digest("hex");
    const hashFile = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
    const nupkgSha256 = await hashFile(nupkg);
    const releasesSha256 = await hashFile(releases);
    const runtimeSha256 = createHash("sha256").update(await readFile(runtime)).digest("hex");
    const filename = basename(setup);
    if (manifestPath || sumsPath) {
      if (!manifestPath || !sumsPath) throw new Error("artifact-output");
      const manifest = { version: packageMetadata.version, channel: packageMetadata.version.includes("-") ? "preview" : "stable", platform: "windows", architecture: "x64", publisher: "UNAVAILABLE", timestamped: false, minimumUpdaterVersion: "1.0.0", filename, size: setupStats.size, sha256: setupSha256, codexRuntimeVersion: expectedRuntimeVersion, signature: "UNSIGNED", signatureState: "UNSIGNED", artifacts: [{ filename, size: setupStats.size, sha256: setupSha256, kind: "setup" }, { filename: nupkgName, size: nupkgStats.size, sha256: nupkgSha256, kind: "squirrel-full" }, { filename: releasesName, size: releasesStats.size, sha256: releasesSha256, kind: "squirrel-releases" }] };
      await writeFile(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(resolve(sumsPath), `${setupSha256}  ${filename}\n${nupkgSha256}  ${nupkgName}\n${releasesSha256}  ${releasesName}\n`, "utf8");
    }
    console.log(`CHATCOM_DESKTOP_PACKAGE kind=VALID setup_bytes=${setupStats.size} sha256=${setupSha256} runtime=FOUND`);
    console.log(`CHATCOM_DESKTOP_MANIFEST version=${packageMetadata.version} channel=${packageMetadata.version.includes("-") ? "preview" : "stable"} architecture=x64 setup_bytes=${setupStats.size} setup_sha256=${setupSha256} nupkg_bytes=${nupkgStats.size} releases_bytes=${releasesStats.size} signature=UNSIGNED runtime_bytes=${runtimeStats.size} runtime_sha256=${runtimeSha256}`);
  } catch {
    console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=PACKAGE_INVALID");
    process.exitCode = 1;
  }
}
