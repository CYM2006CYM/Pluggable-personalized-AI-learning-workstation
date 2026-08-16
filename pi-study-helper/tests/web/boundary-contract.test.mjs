import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "../..");
const webRoot = join(packageRoot, "src", "web");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "mocks" ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|html)$/u.test(entry.name) ? [path] : [];
  });
}

describe("W4 Web boundary contract", () => {
  it("uses a Web-only Vite root, same-origin proxy, strict port, and deny rules", () => {
    const config = readFileSync(join(packageRoot, "vite.config.ts"), "utf8");
    expect(config).toContain("root: webRoot");
    expect(config).toContain('target: "http://127.0.0.1:4310"');
    expect(config).toContain("bootstrap");
    expect(config).toContain("sessions");
    expect(config).toContain("activities");
    expect(config).not.toContain('proxy: { "/api"');
    expect(config).toContain("strictPort: true");
    for (const denied of ["mocks", "private", "rubrics", "reference-solutions", "hidden"]) expect(config).toContain(`**/${denied}/**`);
    expect(config).toContain("**/fixtures/profiles/**");
    expect(readFileSync(join(webRoot, "index.html"), "utf8")).toContain('src="/main.tsx"');
  });

  it("keeps runtime Web source independent from mock DTO modules", () => {
    const offenders = sourceFiles(webRoot).filter((path) => readFileSync(path, "utf8").includes("/mocks/") || readFileSync(path, "utf8").includes("../mocks"));
    expect(offenders).toEqual([]);
  });

  it("does not import repositories, demo composition, or private assets into Web runtime", () => {
    const source = sourceFiles(webRoot).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/repositories|src\/demo|fixtures\/profiles|answer-key|hiddenTests|referenceSolution/iu);
  });
});
