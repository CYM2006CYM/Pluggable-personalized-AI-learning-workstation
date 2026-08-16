import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Recording {
  graphId: string;
  runId: string;
  status: string;
  traceSummary: string;
  payload?: { candidateFeedback?: string };
}

describe("W4 E independent recorded-response audit", () => {
  it("recalculates the sealed six-class fixture and keeps live execution unclaimed", async () => {
    const fixturePath = resolve(import.meta.dirname, "../../fixtures/model-responses/w4/recorded-responses.json");
    const indexPath = resolve(import.meta.dirname, "../../scripts/w4-d-validation/recorded-response-index.json");
    const [fixtureText, indexText] = await Promise.all([readFile(fixturePath, "utf8"), readFile(indexPath, "utf8")]);
    const fixture = JSON.parse(fixtureText) as { recordings: Recording[] };
    const index = JSON.parse(indexText.replace(/^\uFEFF/u, "")) as {
      fixtureSha256: string;
      liveStatus: string;
      recordingCount: number;
      requiredClasses: Array<{ class: string; runIds: string[]; status: string }>;
    };

    expect(createHash("sha256").update(fixtureText).digest("hex")).toBe(index.fixtureSha256);
    expect(fixture.recordings).toHaveLength(index.recordingCount);
    expect(index.liveStatus).toBe("LIVE_NOT_RUN");
    expect(index.requiredClasses.map((item) => item.class)).toEqual([
      "normal_success", "invalid_schema", "timeout", "provider_error", "high_risk_review", "authority_rejected",
    ]);
    expect(index.requiredClasses.every((item) => item.status === "RECORDED_PRESENT" && item.runIds.every((runId) => fixture.recordings.some((recording) => recording.runId === runId)))).toBe(true);
  });

  it("replays review order, fallback markers and authority rejection without trusting D conclusions", async () => {
    const fixturePath = resolve(import.meta.dirname, "../../fixtures/model-responses/w4/recorded-responses.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { recordings: Recording[] };
    const highRisk = fixture.recordings.filter((item) => item.runId.startsWith("w4-high-risk."));
    expect(highRisk.map((item) => item.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);

    for (const runId of ["w4-invalid-schema.generator", "w4-timeout.generator", "w4-provider-error.generator"]) {
      expect(fixture.recordings.find((item) => item.runId === runId)?.traceSummary).toMatch(/^MOCK_FALLBACK_USED:/u);
    }

    const rejected = fixture.recordings.find((item) => item.runId === "w4-authority-rejected.generator");
    expect(rejected?.payload?.candidateFeedback).toContain('"Evidence"');
    expect(rejected?.traceSummary).toBe("MOCK_FALLBACK_USED:authority-rejected");
  });
});
