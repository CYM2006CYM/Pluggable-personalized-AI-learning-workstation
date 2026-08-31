import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("competition launcher delivery", () => {
  it("keeps the double-click entry bound to the PowerShell launcher", async () => {
    const command = await readFile(resolve(root, "start-competition-demo.cmd"), "utf8");
    expect(command).toContain("scripts\\competition-launcher-ui.ps1");
    expect(command).toContain("-ExecutionPolicy Bypass");
    expect(command).toContain("-STA");
  });

  it("offers a repository-root entry for GitHub ZIP users", async () => {
    const command = await readFile(resolve(root, "..", "start-pi-study-helper.cmd"), "utf8");
    expect(command).toContain("pi-study-helper\\start-competition-demo.cmd");
  });

  it("checks the exact contract and delegates data selection to the current seal", async () => {
    const launcherPath = resolve(root, "scripts/competition-launcher.ps1");
    const launcherBytes = await readFile(launcherPath);
    const launcher = launcherBytes.toString("utf8");
    expect([...launcherBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    for (const expected of ["v22.23.1", "10.9.8", "3.13.7", "3.0.5"]) {
      expect(launcher).toContain(expected);
    }
    expect(launcher).toContain("Remove-Item Env:PI_STUDY_DATA");
    expect(launcher).not.toContain(".demo-data-live");
    expect(launcher).toContain('Read-Host "请输入 DeepSeek API Key（输入时不显示）" -AsSecureString');
    expect(launcher).toContain("PI_LAUNCHER_API_KEY");
    expect(launcher).not.toContain("Ensure-Git");
    expect(launcher).not.toContain("winget.exe");
    expect(launcher).toContain("Invoke-WebRequest -UseBasicParsing -Uri $Url");
    expect(launcher).toContain('$npmScript = "demo:live"');
    expect(launcher).not.toMatch(/C:\\Users\\[^"\r\n]+/u);
  });

  it("uses an integrity-locked HTTPS SDK archive without requiring Git", async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string>; resolved?: string; integrity?: string }>;
    };
    const dependency = packageJson.dependencies["pi-loop-graph-sdk"];
    expect(dependency).toBe("https://codeload.github.com/0liveiraaa/pi-loop-graph-sdk/tar.gz/401d3e9bfa49e630196caefbabd732a3209b17a0");
    expect(lock.packages[""]?.dependencies?.["pi-loop-graph-sdk"]).toBe(dependency);
    expect(lock.packages["node_modules/pi-loop-graph-sdk"]?.resolved).toBe(dependency);
    expect(lock.packages["node_modules/pi-loop-graph-sdk"]?.integrity).toMatch(/^sha512-/u);
  });

  it("passes the GUI key through child-process memory rather than command-line arguments", async () => {
    const ui = await readFile(resolve(root, "scripts/competition-launcher-ui.ps1"), "utf8");
    expect(ui).toContain("UseSystemPasswordChar");
    expect(ui).toContain("$env:PI_LAUNCHER_API_KEY = $apiKey");
    expect(ui).toContain("Remove-Item Env:PI_LAUNCHER_API_KEY");
    expect(ui).toContain("UI_SMOKE_OK");
    expect(ui).not.toMatch(/-ApiKey|-Key\s+\$apiKey/u);
  });
});
