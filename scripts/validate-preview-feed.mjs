import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const valueFor = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const rootPath = valueFor("--root");
const manifestPath = valueFor("--manifest");

function failure(code) {
  console.log(`CHATCOM_PREVIEW_FEED kind=FAILURE code=${code}`);
  process.exitCode = 1;
}

function safePublisher(value) {
  if (typeof value !== "string") return false;
  const subject = value.replace(/[\r\n\t]+/gu, " ").trim();
  return subject.length > 0 && subject.length <= 512 && subject !== "UNKNOWN" && subject !== "UNAVAILABLE";
}

function isInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

if (!rootPath || !manifestPath) {
  failure("USAGE_INVALID");
} else {
  try {
    const root = resolve(rootPath);
    const manifestFile = resolve(manifestPath);
    if (!isInside(root, manifestFile)) throw new Error("manifest-location");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    if (manifest.channel !== "preview" || manifest.platform !== "windows" || manifest.architecture !== "x64") throw new Error("platform");
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) throw new Error("version");
    if (manifest.signatureState !== "SIGNED" || manifest.signature !== "SIGNED" || manifest.timestamped !== true || !safePublisher(manifest.publisher) || !safePublisher(manifest.approvedPublisherSubject) || manifest.publisher !== manifest.approvedPublisherSubject) throw new Error("signature-required");
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) throw new Error("artifacts");
    const kinds = new Set();
    for (const artifact of manifest.artifacts) {
      if (!artifact || typeof artifact.filename !== "string" || artifact.filename.includes("/") || artifact.filename.includes("\\") || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !/^[a-f0-9]{64}$/u.test(artifact.sha256) || !["setup", "squirrel-full", "squirrel-releases"].includes(artifact.kind)) throw new Error("artifact-shape");
      kinds.add(artifact.kind);
      const matches = [];
      const pending = [root];
      while (pending.length > 0) {
        const directory = pending.pop();
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const candidate = resolve(directory, entry.name);
          if (!isInside(root, candidate)) throw new Error("artifact-location");
          if (entry.isDirectory()) pending.push(candidate);
          else if (entry.isFile() && entry.name === artifact.filename) matches.push(candidate);
        }
      }
      if (matches.length !== 1) throw new Error("artifact-missing");
      const info = await stat(matches[0]);
      if (info.size !== artifact.size) throw new Error("artifact-size");
      const digest = createHash("sha256").update(await readFile(matches[0])).digest("hex");
      if (digest !== artifact.sha256) throw new Error("artifact-hash");
    }
    if (kinds.size !== 3) throw new Error("artifact-set");
    console.log(`CHATCOM_PREVIEW_FEED kind=VALID version=${manifest.version} signature=SIGNED artifacts=3 publisher=CONFIGURED`);
  } catch {
    failure("PREVIEW_FEED_INVALID");
  }
}
