import { createServer } from "vite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [summaryScript, outputPath] = process.argv.slice(2);
if (!summaryScript || !outputPath) {
  throw new Error("Usage: node run-diagnostic-summary-vite.mjs <summary-script> <output.json>");
}

const server = await createServer({
  appType: "custom",
  configFile: false,
  root: resolve(import.meta.dirname, "../../../../"),
  server: { middlewareMode: true },
});

try {
  process.argv = [process.execPath, summaryScript, outputPath];
  await server.ssrLoadModule(pathToFileURL(summaryScript).href);
} finally {
  await server.close();
}
