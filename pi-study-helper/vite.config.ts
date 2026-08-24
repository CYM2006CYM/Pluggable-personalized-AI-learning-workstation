import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = fileURLToPath(new URL("./src/web", import.meta.url));
const contractsRoot = fileURLToPath(new URL("./src/contracts", import.meta.url));
const apiPort = Number(process.env.PI_STUDY_API_PORT ?? "4310");

if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("PI_STUDY_API_PORT must be a valid TCP port.");
}

const apiProxy = {
  "^/api/(?:bootstrap(?:\\?|$)|sessions(?:/|$)|activities(?:/|$))": {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: false,
  },
};

export default defineConfig({
  root: webRoot,
  cacheDir: resolve(webRoot, "node_modules/.vite"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
    fs: {
      strict: true,
      allow: [webRoot, contractsRoot],
      deny: ["**/mocks/**", "**/fixtures/profiles/**", "**/fixtures/model-*/**", "**/private/**", "**/rubrics/**", "**/reference-solutions/**", "**/hidden/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: "../../dist-web",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  test: {
    root: packageRoot,
    environment: "node",
  },
});
