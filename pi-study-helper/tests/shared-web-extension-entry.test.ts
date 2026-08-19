import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoRuntime, type DemoRuntime } from "../src/demo/composition-root.js";
import studyHelperExtension from "../src/extension/index.js";
import { FilePendingActivityStore } from "../src/tui/file-pending-activity-store.js";
import { parsePendingActivity } from "../src/tui/shared-session.js";

interface RegisteredCommand {
  handler(args: string, context: unknown): Promise<void>;
}

const roots: string[] = [];
const runtimes: DemoRuntime[] = [];
const fixturesRoot = resolve(process.cwd(), "fixtures/profiles");

afterEach(async () => {
  vi.unstubAllEnvs();
  while (runtimes.length > 0) await runtimes.pop()!.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function activeSession(runtime: DemoRuntime): Promise<{
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  pathVersion: number;
}> {
  const bootstrap = await runtime.bootstrap.getBootstrap({});
  const chapterId = bootstrap.chapters[0]?.chapterId;
  if (chapterId === undefined) throw new Error("Expected a chapter fixture");
  const started = await runtime.facade.startSession({
    requestId: "tui-start",
    subjectId: "pandas-cleaning",
    mode: "chapter",
    goalId: "goal-clean-orders",
    chapterId,
    availableMinutes: 400,
  });
  const background = {
    python_experience: "basic" as const,
    pandas_experience: "basic" as const,
    explanation_preference: "step_by_step" as const,
  };
  const draft = await runtime.facade.saveDiagnosticDraft({
    requestId: "tui-diagnostic-draft",
    sessionId: started.sessionId,
    sessionVersion: started.sessionVersion,
    profileRevision: started.profileRevision,
    diagnosticId: bootstrap.diagnostic.diagnosticId,
    diagnosticVersion: bootstrap.diagnostic.diagnosticVersion,
    diagnosticDraftVersion: 0,
    background,
  });
  const completed = await runtime.facade.completeDiagnostic({
    requestId: "tui-diagnostic-complete",
    sessionId: started.sessionId,
    sessionVersion: draft.sessionVersion,
    profileRevision: started.profileRevision,
    diagnosticDraftVersion: draft.diagnosticDraftVersion,
    mode: "background_only",
    background,
  });
  const built = await runtime.facade.buildPath({
    requestId: "tui-build-path",
    sessionId: started.sessionId,
    sessionVersion: completed.sessionVersion,
    profileRevision: started.profileRevision,
    goalId: "goal-clean-orders",
    mode: "chapter",
    chapterId,
    availableMinutes: 400,
    evidenceVersion: completed.evidenceVersion,
    selectedKnowledgePointIds: [],
    lockedNodeIds: [],
  });
  if (built.status !== "candidate" || built.pathId === undefined || built.pathVersion === undefined) {
    throw new Error("Expected a candidate path");
  }
  const confirmed = await runtime.facade.confirmPath({
    requestId: "tui-confirm-path",
    sessionId: started.sessionId,
    sessionVersion: built.sessionVersion,
    profileRevision: started.profileRevision,
    pathId: built.pathId,
    pathVersion: built.pathVersion,
  });
  return {
    sessionId: started.sessionId,
    sessionVersion: confirmed.sessionVersion,
    profileRevision: started.profileRevision,
    pathVersion: confirmed.pathVersion,
  };
}

async function extensionHarness(dataRoot: string) {
  vi.stubEnv("PI_STUDY_DATA", dataRoot);
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    registerCommand(name: string, command: RegisteredCommand) { commands.set(name, command); },
    on: vi.fn(),
  };
  await studyHelperExtension(pi as never);
  const notifications: Array<{ message: string; level?: string }> = [];
  const context = {
    isIdle: () => true,
    ui: {
      notify(message: string, level?: string) { notifications.push({ message, level }); },
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      input: vi.fn(),
      select: vi.fn(),
    },
  };
  const command = commands.get("study-web");
  if (command === undefined) throw new Error("study-web command was not registered");
  return { command, context, notifications };
}

describe("W5-D2 real Pi/TUI shared Web entry", () => {
  it("rejects unsafe pending payloads at the file persistence boundary", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-d2-pending-store-"));
    roots.push(dataRoot);
    const store = new FilePendingActivityStore(dataRoot);

    expect(() => store.save(JSON.stringify({ sessionId: "session-1", answer: "secret" }))).toThrow();
    expect(store.load()).toBeUndefined();
  });

  it("uses the registered extension command to persist pending state without changing server facts", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-d2-tui-entry-"));
    roots.push(dataRoot);
    const runtime = await createDemoRuntime({ dataRoot, fixturesRoot });
    runtimes.push(runtime);
    const session = await activeSession(runtime);
    const before = await runtime.bootstrap.getBootstrap({ recoverSessionId: session.sessionId });
    const { command, context, notifications } = await extensionHarness(dataRoot);

    await command.handler(session.sessionId, context);

    const raw = new FilePendingActivityStore(dataRoot).load();
    expect(raw).toBeDefined();
    expect(parsePendingActivity(raw!)).toMatchObject({
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      profileRevision: session.profileRevision,
      pathVersion: session.pathVersion,
    });
    expect(notifications.at(-1)).toMatchObject({
      level: "info",
      message: expect.stringContaining(`http://localhost:5173/study?sessionId=${session.sessionId}`),
    });
    expect(await runtime.bootstrap.getBootstrap({ recoverSessionId: session.sessionId })).toEqual(before);
  }, 30_000);

  it("routes a missing session to the Web start page without creating a replacement", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-d2-tui-missing-"));
    roots.push(dataRoot);
    const { command, context, notifications } = await extensionHarness(dataRoot);

    await command.handler("missing-session", context);

    expect(notifications.at(-1)).toEqual({
      level: "warning",
      message: "当前深链不可继续，请从 Web 开始页恢复：http://localhost:5173/",
    });
    expect(new FilePendingActivityStore(dataRoot).load()).toBeUndefined();
    const runtime = await createDemoRuntime({ dataRoot, fixturesRoot });
    runtimes.push(runtime);
    expect((await runtime.bootstrap.getBootstrap({})).recoverableSessions).toEqual([]);
  });
});
