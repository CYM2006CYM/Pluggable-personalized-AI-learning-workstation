import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

interface VerificationResult {
  status: string;
  upstream: { cFormalCommit: string; decisionId: string };
  environment: { decision: string; lockSha256: string; pyodide: string; measuredDualBackend: boolean };
  revision3: { entryCount: number; assetTreeSha256: string; storedSealMatches: boolean };
  revision2: { fileCount: number; treeSha256: string; unchanged: boolean };
  showcases: {
    caseCount: number;
    pairCount: number;
    minimumHypothesesPerPair: number;
    actualPathOutputIncluded: boolean;
    aPathEngineStatus: string;
    eIndependentReviewStatus: string;
  };
}

describe("W5-D3 B environment lock, seal and showcase inputs", () => {
  let result: VerificationResult;

  beforeAll(() => {
    const appRoot = resolve(import.meta.dirname, "..");
    const stdout = execFileSync(process.execPath, [resolve(appRoot, "scripts/w5-b-d3/verify-w5-b-d3.mjs"), "--check-only"], {
      cwd: appRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
    });
    result = JSON.parse(stdout) as VerificationResult;
  });

  it("binds the owner decision and C's formal D3 commit", () => {
    expect(result.status).toBe("PASS");
    expect(result.upstream).toEqual({
      cFormalCommit: "6acc56fa03986797be54156af639a905c2e74a64",
      decisionId: "W5-D64-PYODIDE-1",
    });
  });

  it("keeps the measured Node lock unchanged without claiming dual backend", () => {
    expect(result.environment).toMatchObject({
      decision: "NO_PROFILE_BYTE_CHANGE_REQUIRED",
      lockSha256: "59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43",
      pyodide: "NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE",
      measuredDualBackend: false,
    });
  });

  it("recalculates the current revision 3 seal", () => {
    expect(result.revision3).toEqual({
      entryCount: 84,
      assetTreeSha256: "f0c009169a090de8ec9beb5afcf6aaa971f8aac847e235c96c36720f6de8d45c",
      storedSealMatches: true,
    });
  });

  it("keeps revision 2 byte-for-byte unchanged", () => {
    expect(result.revision2).toEqual({
      fileCount: 71,
      treeSha256: "2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d",
      unchanged: true,
    });
  });

  it("delivers three replayable inputs and labels every difference as expected-only", () => {
    expect(result.showcases).toMatchObject({
      caseCount: 3,
      pairCount: 3,
      minimumHypothesesPerPair: 4,
      actualPathOutputIncluded: false,
      aPathEngineStatus: "PENDING",
      eIndependentReviewStatus: "PENDING",
    });
  });
});
