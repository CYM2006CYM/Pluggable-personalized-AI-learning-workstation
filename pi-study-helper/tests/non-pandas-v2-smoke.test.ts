import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProfileDirectoryDiagnosticLoader } from "../src/application/diagnostic-runtime.js";
import { validateProfileV2Directory } from "../src/domain/profile-v2-schema.js";

const FIXTURE = resolve(process.cwd(), "tests", "fixtures", "profile-v2", "non-pandas-diagnostic");

describe("non-Pandas v2 smoke fixture", () => {
  it("loads the common Profile and diagnostic contracts without Pandas-specific fields", async () => {
    const manifest = await validateProfileV2Directory(FIXTURE, "draft");
    const loader = createProfileDirectoryDiagnosticLoader(() => FIXTURE);
    const assets = await loader(manifest.subjectId, manifest.revision);
    expect(manifest.subjectId).toBe("javascript-basics");
    expect(assets.blueprint.questions).toHaveLength(1);
    expect(assets.blueprint.questions[0]).toMatchObject({
      knowledgePointId: "javascript.variables",
      kind: "single_choice",
    });
    expect(assets.answerKey.answers[0]).toMatchObject({ correctAnswer: "const" });
  });
});
