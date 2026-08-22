import { lstat, mkdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const repositoryRoot = resolve(process.cwd());
const configured = process.env.CHATCOM_OUT_DIR?.trim() || "out-desktop";
const outputPath = resolve(repositoryRoot, configured);
const repositoryRelative = relative(repositoryRoot, outputPath);
const temporaryRoot = resolve(tmpdir());
const temporaryRelative = relative(temporaryRoot, outputPath);
const isDirectChild = (value) => value !== "" && !value.includes(sep) && !value.includes("/") && !value.includes("\\");
const isRepositoryOutput = isDirectChild(repositoryRelative) && /^out-desktop(?:[-.][A-Za-z0-9._-]+)?$/u.test(basename(outputPath));
const isTemporaryOutput = dirname(outputPath) === temporaryRoot && /^chatcom-[A-Za-z0-9._-]+$/u.test(basename(outputPath));

if (!isAbsolute(outputPath) || !isRepositoryOutput && !isTemporaryOutput || outputPath === repositoryRoot || repositoryRelative.startsWith(`..${sep}`) && !isTemporaryOutput) {
  console.log("CHATCOM_DESKTOP_OUTPUT kind=FAILURE code=OUTPUT_PATH_REJECTED");
  process.exitCode = 1;
} else {
  try {
    try {
      const existing = await lstat(outputPath);
      if (existing.isSymbolicLink()) throw new Error("OUTPUT_SYMLINK_REJECTED");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rm(outputPath, { recursive: true, force: true });
    await mkdir(outputPath, { recursive: true });
    console.log("CHATCOM_DESKTOP_OUTPUT kind=READY target=VERIFIED_CLEAN");
  } catch {
    console.log("CHATCOM_DESKTOP_OUTPUT kind=FAILURE code=OUTPUT_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
