import { describe, expect, it } from "vitest";
import {
  hashPublicExecutionBundle,
  projectPublicExecutionBundle,
  sha256Text,
  validatePublicExecutionBundle,
} from "../src/application/public-execution-bundle.js";
import type { PublicExecutionBundle } from "../src/contracts/index.js";

const preparedAt = "2026-08-18T03:00:00.000Z";
const binding = {
  sessionId: "session-1",
  activityId: "activity-1",
  profileRevision: 3,
  environmentId: "environment-1",
};

function bundle(): PublicExecutionBundle {
  return projectPublicExecutionBundle({
    run: { runId: "run-1", ...binding, createdAt: preparedAt },
    profileRevision: binding.profileRevision,
    environmentId: binding.environmentId,
    starterCode: "print('starter')\n",
    publicDatasetFiles: [{ name: "data.csv", content: "x\n1\n", hash: sha256Text("x\n1\n") }],
    publicTestSources: ["def test_public():\n    assert True\n"],
  });
}

describe("W5 A public execution bundle", () => {
  it("projects the exact public contract deterministically from prepared server state", () => {
    const first = bundle();
    const second = bundle();
    expect(first).toEqual(second);
    expect(Object.keys(first).sort()).toEqual([
      "activityId", "bundleHash", "environmentId", "expiresAt", "profileRevision",
      "publicDatasetFiles", "publicTestSources", "runId", "sessionId", "starterCodeHash",
    ].sort());
    expect(first).toMatchObject({
      ...binding,
      runId: "run-1",
      expiresAt: "2026-08-18T03:05:00.000Z",
      starterCodeHash: sha256Text("print('starter')\n"),
    });
    expect(first.bundleHash).toBe(hashPublicExecutionBundle(first));
    expect(JSON.stringify(first)).not.toMatch(/assetBundleHash|hiddenTests?|referenceSolution|rubric|[A-Za-z]:[\\/]/iu);
  });

  it.each([
    ["runId", "run-tampered"],
    ["sessionId", "session-tampered"],
    ["activityId", "activity-tampered"],
    ["profileRevision", 4],
    ["starterCodeHash", `sha256:${"0".repeat(64)}`],
    ["expiresAt", "2026-08-18T03:06:00.000Z"],
    ["bundleHash", `sha256:${"0".repeat(64)}`],
  ] as const)("rejects a tampered %s binding or digest", (field, value) => {
    expect(() => validatePublicExecutionBundle({ ...bundle(), [field]: value }, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
  });

  it("rejects environment mismatch separately", () => {
    expect(() => validatePublicExecutionBundle({ ...bundle(), environmentId: "environment-other" }, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "environment_mismatch" }));
  });

  it("rejects expired bundles and invalid public file content hashes", () => {
    expect(() => validatePublicExecutionBundle(bundle(), binding, new Date("2026-08-18T03:05:00.000Z")))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
    const invalidFile = structuredClone(bundle());
    invalidFile.publicDatasetFiles[0]!.content = "tampered";
    expect(() => validatePublicExecutionBundle(invalidFile, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
    const changedTest = bundle();
    changedTest.publicTestSources[0] = "def test_tampered(): pass";
    expect(() => validatePublicExecutionBundle(changedTest, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
  });

  it("rejects duplicate names and non-contract fields", () => {
    const duplicate = bundle();
    duplicate.publicDatasetFiles.push({ ...duplicate.publicDatasetFiles[0]! });
    duplicate.bundleHash = hashPublicExecutionBundle(duplicate);
    expect(() => validatePublicExecutionBundle(duplicate, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
    expect(() => validatePublicExecutionBundle({ ...bundle(), hiddenTests: ["secret"] }, binding, new Date(preparedAt)))
      .toThrow(expect.objectContaining({ errorCode: "activity_lifecycle_conflict" }));
  });
});
