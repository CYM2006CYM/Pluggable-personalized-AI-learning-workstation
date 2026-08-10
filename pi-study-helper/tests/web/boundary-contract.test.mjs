import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(packageRoot, "src");
const webRoot = join(sourceRoot, "web");

function sourceFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("W3 D46 frontend dependency and ownership boundaries", () => {
  it("uses only the exact frozen frontend dependency versions", () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const packageLock = JSON.parse(readFileSync(join(packageRoot, "package-lock.json"), "utf8"));

    expect(packageJson.dependencies).toEqual({
      "pi-loop-graph-sdk": "github:0liveiraaa/pi-loop-graph-sdk#401d3e9",
      react: "18.3.1",
      "react-dom": "18.3.1",
      "react-router-dom": "6.30.1",
      zustand: "5.0.14",
    });
    expect(packageJson.devDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "0.80.3",
      "@earendil-works/pi-tui": "0.80.3",
      "@types/react": "18.3.12",
      "@types/react-dom": "18.3.1",
      "@vitejs/plugin-react": "5.0.4",
      jsdom: "26.1.0",
      typebox: "1.3.5",
      typescript: "5.9.3",
      vite: "7.1.7",
      vitest: "4.1.10",
    });
    expect(packageJson.allowScripts).toBeUndefined();
    expect(packageLock.packages["node_modules/pi-loop-graph-sdk"]).toMatchObject({
      version: "0.2.0",
      resolved: "git+ssh://git@github.com/0liveiraaa/pi-loop-graph-sdk.git#401d3e9bfa49e630196caefbabd732a3209b17a0",
    });
    expect(packageLock.packages[""].allowScripts).toBeUndefined();
  });

  it("keeps page display fixtures inside the Web layer", () => {
    const outsideWeb = sourceFiles(sourceRoot).filter((path) => !path.startsWith(`${webRoot}\\`) && !path.startsWith(`${webRoot}/`));
    for (const path of outsideWeb) {
      const source = readFileSync(path, "utf8");
      expect(source, relative(sourceRoot, path)).not.toMatch(/PAGE_DISPLAY_FIXTURES|ProfileDisplayFixture|DiagnosticQuestionDisplayFixture|LearningCardDisplayFixture/);
    }
  });

  it("contains no forbidden browser capabilities or client-side result calculations", () => {
    const webSource = sourceFiles(webRoot).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(webSource).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios\s*\.|https?:\/\//i);
    expect(webSource).not.toMatch(/pyodide|review[-_ ]?page|审核页/i);
    expect(webSource).not.toMatch(/score\s*\*\s*100|100\s*\*\s*[^\n]*score|verdict\s*===?\s*["']pass["']/i);
    expect(webSource).not.toMatch(/repository|unitOfWork|writeTransaction|rollbackTransaction/i);
  });

  it("does not define page fixtures with public SafeView or SafeSummary names", () => {
    const mockSource = readFileSync(join(webRoot, "mocks", "safe-dtos.ts"), "utf8");
    expect(mockSource).not.toMatch(/export interface \w+Safe(?:View|Summary)/);
  });
});
