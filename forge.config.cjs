const path = require("node:path");

module.exports = {
  outDir: process.env.CHATCOM_OUT_DIR || "out-desktop",
  packagerConfig: {
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
    prune: false,
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "chatcom",
        setupExe: "ChatCOM Setup.exe",
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
