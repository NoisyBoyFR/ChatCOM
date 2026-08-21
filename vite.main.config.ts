import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "apps/desktop/main/main.ts"),
      fileName: () => "main.cjs",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
