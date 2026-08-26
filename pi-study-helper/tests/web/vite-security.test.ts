import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("W4 Vite direct-access boundary", () => {
  it("serves the Web root and rejects runtime mocks and private asset paths", async () => {
    try {
      server = await createServer({
        configFile: resolve(import.meta.dirname, "../../vite.config.ts"),
        logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, strictPort: false },
      });
      await server.listen();
      const address = server.httpServer!.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      const home = await fetch(origin);
      expect(home.status).toBe(200);
      expect(home.headers.get("x-content-type-options")).toBe("nosniff");
      expect(home.headers.get("x-frame-options")).toBe("DENY");
      expect(home.headers.get("referrer-policy")).toBe("no-referrer");
      expect(home.headers.get("permissions-policy")).toContain("camera=()");
      expect(await home.text()).toContain("/main.tsx");

      const webApiModule = await fetch(`${origin}/api/client.ts`);
      expect(webApiModule.status).toBe(200);
      expect(webApiModule.headers.get("content-type")).toMatch(/javascript/iu);
      expect(await webApiModule.text()).toContain("export const api");

    const privateTargets = [
      "/mocks/safe-dtos.ts",
      "/fixtures/profiles/pandas-cleaning-revision-3-draft/profile.json",
      "/private/answer-key.json",
      "/datasets/private/orders-variant-03-large.csv",
      "/datasets/private/expected/act-practical/dataset-private-variant-03-large.json",
      "/assessments/private/code-fixture-cases.json",
      "/rubrics/rubric-practical.json",
      "/hidden/tests.py",
      "/reference-solutions/solution.py",
      `/@fs/${resolve(import.meta.dirname, "../../fixtures/profiles/pandas-cleaning-revision-3-draft/profile.json").replaceAll("\\", "/")}`,
    ];
      for (const target of privateTargets) {
        let response: Response;
        try {
          response = await fetch(`${origin}${target}`);
        } catch (error) {
          expect(String(error), target).toMatch(/fetch failed|ECONNRESET|ECONNREFUSED/iu);
          continue;
        }
        if (response.status >= 400) continue;
        const text = await response.text();
        expect(response.headers.get("content-type"), target).toMatch(/text\/html/iu);
        expect(text, target).toContain('<div id="root"></div>');
        expect(text, target).not.toMatch(/schemaVersion|correctAnswer|answerKey|hiddenTests|rubricRef|referenceSolution|expectedOutputSha256|dataset-private-variant-03/iu);
      }
    } finally { /* afterEach closes the development-only server. */ }
  }, 30_000);
});
