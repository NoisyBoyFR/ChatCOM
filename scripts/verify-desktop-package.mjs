import { createHash } from "node:crypto";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const valueFor = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const setupPath = valueFor("--setup");
const appPath = valueFor("--app");
const manifestPath = valueFor("--manifest");
const sumsPath = valueFor("--sums");
const expectSigned = args.includes("--expect-signed");
const publisherSubject = valueFor("--approved-publisher-subject") ?? valueFor("--publisher-subject");
const expectedRuntimeVersion = "0.149.0";
const optionsWithValues = new Set(["--setup", "--app", "--manifest", "--sums", "--publisher-subject", "--approved-publisher-subject"]);
const flags = new Set(["--expect-signed"]);
const publisherConfigured = typeof publisherSubject === "string" && publisherSubject.length > 0 && publisherSubject.length <= 512 && publisherSubject === publisherSubject.trim() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n\t]/u.test(publisherSubject) && !["UNKNOWN", "UNAVAILABLE"].includes(publisherSubject);
let argumentsValid = true;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (flags.has(argument)) continue;
  if (!optionsWithValues.has(argument) || args[index + 1] === undefined || args[index + 1].startsWith("--")) { argumentsValid = false; break; }
  index += 1;
}

if (!argumentsValid || !setupPath || !appPath || Boolean(manifestPath) !== Boolean(sumsPath) || expectSigned !== publisherConfigured) {
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
    const files = [];
    const pending = [app];
    while (pending.length > 0) {
      const directory = pending.pop();
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const candidate = resolve(directory, entry.name);
        const pathParts = relative(app, candidate).split(/[\\/]/u).filter(Boolean);
        if (pathParts.some((part) => part === "out" || /^out-desktop(?:[-.].*)?$/iu.test(part))) throw new Error("output-recursion");
        if (entry.isDirectory()) pending.push(candidate);
        else if (entry.isFile()) files.push(candidate);
      }
    }
    const runtimeCandidates = files.filter((file) => basename(file).toLowerCase() === "codex.exe");
    if (runtimeCandidates.length !== 1) throw new Error("runtime-count");
    const runtime = runtimeCandidates[0];
    const runtimePackage = dirname(dirname(dirname(dirname(runtime))));
    const runtimePackageMetadata = JSON.parse(await readFile(resolve(runtimePackage, "package.json"), "utf8"));
    if (typeof runtimePackageMetadata.version !== "string" || !(runtimePackageMetadata.version === expectedRuntimeVersion || runtimePackageMetadata.version.startsWith(`${expectedRuntimeVersion}-`))) throw new Error("runtime-version");
    const versionProbe = spawnSync(runtime, ["--version"], { shell: false, windowsHide: true, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
    if (versionProbe.status !== 0 || !new RegExp(`\\b${expectedRuntimeVersion.replaceAll(".", "\\.")}(?:-[A-Za-z0-9.-]+)?\\b`, "u").test(`${versionProbe.stdout ?? ""}`)) throw new Error("runtime-executable");
    const runtimeStats = await stat(runtime);
    if (expectSigned) {
      for (const signedPath of [setup, resolve(app, "ChatCOM.exe")]) {
        const signatureProbe = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts", "verify-windows-signature.ps1"), "-Path", signedPath, "-ExpectedSubject", publisherSubject, "-RequireTimestamp"], { shell: false, windowsHide: true, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
        if (signatureProbe.status !== 0 || !`${signatureProbe.stdout ?? ""}`.includes("CHATCOM_SIGNATURE kind=VALID")) throw new Error("signature");
      }
    }
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
      const signatureState = expectSigned ? "SIGNED" : "UNSIGNED";
      const manifest = { version: packageMetadata.version, channel: packageMetadata.version.includes("-") ? "preview" : "stable", platform: "windows", architecture: "x64", publisher: publisherSubject ?? "UNAVAILABLE", approvedPublisherSubject: publisherSubject ?? "UNAVAILABLE", timestamped: expectSigned, minimumUpdaterVersion: "1.0.0", filename, size: setupStats.size, sha256: setupSha256, codexRuntimeVersion: expectedRuntimeVersion, signature: signatureState, signatureState, artifacts: [{ filename, size: setupStats.size, sha256: setupSha256, kind: "setup" }, { filename: nupkgName, size: nupkgStats.size, sha256: nupkgSha256, kind: "squirrel-full" }, { filename: releasesName, size: releasesStats.size, sha256: releasesSha256, kind: "squirrel-releases" }] };
      await writeFile(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(resolve(sumsPath), `${setupSha256}  ${filename}\n${nupkgSha256}  ${nupkgName}\n${releasesSha256}  ${releasesName}\n`, "utf8");
    }
    console.log(`CHATCOM_DESKTOP_PACKAGE kind=VALID setup_bytes=${setupStats.size} sha256=${setupSha256} runtime=FOUND`);
    console.log(`CHATCOM_DESKTOP_MANIFEST version=${packageMetadata.version} channel=${packageMetadata.version.includes("-") ? "preview" : "stable"} architecture=x64 setup_bytes=${setupStats.size} setup_sha256=${setupSha256} nupkg_bytes=${nupkgStats.size} releases_bytes=${releasesStats.size} signature=${expectSigned ? "SIGNED" : "UNSIGNED"} runtime_bytes=${runtimeStats.size} runtime_sha256=${runtimeSha256}`);
  } catch {
    console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=PACKAGE_INVALID");
    process.exitCode = 1;
  }
}
