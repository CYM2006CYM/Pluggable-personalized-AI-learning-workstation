import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileBoundSessionRuntime } from "../src/application/profile-bound-session-runtime.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("D3 session Profile binding", () => {
  it("resolves active revision server-side and keeps it out of the client input", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w3-d3-session-")); roots.push(root);
    const fixtures = resolve(root, "fixtures");
    await cp(resolve(process.cwd(), "fixtures", "profiles", "pandas-cleaning-v2-draft"), resolve(fixtures, "pandas-cleaning-v2-draft"), { recursive: true });
    const profiles = new ProfileFamilyRepository({ dataRoot: root, fixturesRoot: fixtures });
    await profiles.activateV2Draft("pandas-cleaning");
    const sessions = new FileLearningSessionRepository({ dataRoot: root });
    const runtime = new ProfileBoundSessionRuntime({ profiles, sessions });
    const started = await runtime.startSession({ requestId: "start-1", subjectId: "pandas-cleaning", mode: "chapter", goalId: "goal-cleaning", availableMinutes: 30 });
    expect(started.profileRevision).toBe(2);
    expect(started.requestId).toBe("start-1");
    expect(await runtime.resolveSessionProfile({ sessionId: started.sessionId, sessionVersion: started.sessionVersion })).toMatchObject({ subjectId: "pandas-cleaning", revision: 2, status: "active" });
  });
});
