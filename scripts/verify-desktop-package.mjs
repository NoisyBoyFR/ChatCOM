import { createHash } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const setupPath = valueFor("--setup");
const appPath = valueFor("--app");
if (!setupPath || !appPath || args.length !== 4) {
  console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=USAGE_INVALID");
  process.exitCode = 1;
} else {
  try {
    const setup = resolve(setupPath);
    const app = resolve(appPath);
    const setupStats = await stat(setup);
    if (!setupStats.isFile() || setupStats.size < 1_000_000) throw new Error("setup");
    const runtime = resolve(app, "resources", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    await access(runtime);
    const hash = createHash("sha256");
    const { createReadStream } = await import("node:fs");
    await new Promise((resolvePromise, reject) => {
      const stream = createReadStream(setup);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolvePromise);
    });
    console.log(`CHATCOM_DESKTOP_PACKAGE kind=VALID setup_bytes=${setupStats.size} sha256=${hash.digest("hex")} runtime=FOUND`);
  } catch {
    console.log("CHATCOM_DESKTOP_PACKAGE kind=FAILURE code=PACKAGE_INVALID");
    process.exitCode = 1;
  }
}
