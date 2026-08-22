const path = require("node:path");
const fs = require("node:fs");

const nativeRuntimeRelativePath = path.join("resources", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

module.exports = {
  outDir: process.env.CHATCOM_OUT_DIR || "out-desktop",
  packagerConfig: {
    ignore: [/^\/out(?:-desktop[^/]*|\/)/u],
    asar: {
      unpack: "**/node_modules/@openai/codex*/**",
    },
    extraResource: [path.resolve(__dirname, "node_modules/@openai")],
    executableName: "ChatCOM",
    name: "ChatCOM",
    appBundleId: "com.noisyboyfr.chatcom",
    win32metadata: {
      CompanyName: "ChatCOM",
      FileDescription: "ChatCOM Desktop local supervised relay",
      ProductName: "ChatCOM Desktop",
    },
  },
  hooks: {
    packageAfterCopy: async (buildPath, _electronVersion, platform, arch) => {
      if (platform === "win32" && arch === "x64" && !fs.existsSync(path.resolve(__dirname, "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"))) {
        throw new Error("CHATCOM_DESKTOP_RUNTIME_MISSING");
      }
    },
    postPackage: async ({ platform, arch, outputPaths }) => {
      if (platform !== "win32" || arch !== "x64") {
        return;
      }

      const packagedRuntimeFound = outputPaths.some((outputPath) =>
        fs.existsSync(path.join(outputPath, nativeRuntimeRelativePath)),
      );
      if (!packagedRuntimeFound) {
        throw new Error("CHATCOM_DESKTOP_RUNTIME_MISSING");
      }
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "chatcom",
        setupExe: "ChatCOM-Desktop-1.0.0-rc.5-Setup.exe",
        noMsi: true,
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: path.resolve(__dirname, "apps/desktop/main/main.ts"), config: path.resolve(__dirname, "vite.main.config.ts") },
          { entry: path.resolve(__dirname, "apps/desktop/preload/preload.ts"), config: path.resolve(__dirname, "vite.preload.config.ts"), target: "preload" },
        ],
        renderer: [{ name: "main_window", config: path.resolve(__dirname, "vite.renderer.config.ts") }],
      },
    },
  ],
};
