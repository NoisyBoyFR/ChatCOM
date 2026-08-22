import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  define: {
    __CHATCOM_APPROVED_PUBLISHER_SUBJECT__: JSON.stringify(process.env.CHATCOM_APPROVED_PUBLISHER_SUBJECT ?? ""),
  },
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
