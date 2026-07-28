import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = resolve(process.cwd(), "fixtures", "safe-views", "start-session-safe-response.json");

describe("E W1 safe-view fixtures", () => {
  it("keeps the start-session fixture on the frozen safe projection", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      fixtureVersion: string;
      useCase: string;
      response: Record<string, unknown>;
      forbiddenCategories: string[];
    };

    expect(fixture.fixtureVersion).toBe("w1-safe-view-v1");
    expect(fixture.useCase).toBe("startSession");
    expect(Object.keys(fixture.response).sort()).toEqual([
      "availableMinutes",
      "chapterId",
      "diagnosticRequired",
      "goalId",
      "mode",
      "profileRevision",
      "requestId",
      "sessionId",
      "sessionVersion",
      "stage",
      "status",
      "subjectId",
    ]);

    const serializedResponse = JSON.stringify(fixture.response);
    for (const forbidden of [
      "correctOptionIndex",
      "hidden_tests",
      "referenceSolution",
      "rubric",
      "apiKey",
      "C:\\",
      "/home/",
      "learnerSubmission",
    ]) {
      expect(serializedResponse).not.toContain(forbidden);
    }
    expect(fixture.forbiddenCategories).toContain("host_absolute_paths");
  });
});
