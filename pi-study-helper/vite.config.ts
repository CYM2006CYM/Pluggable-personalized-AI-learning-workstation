import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  test: {
    environment: "node",
  },
});
