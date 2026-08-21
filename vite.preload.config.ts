import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "apps/desktop/preload/preload.ts"),
      fileName: () => "preload.cjs",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
