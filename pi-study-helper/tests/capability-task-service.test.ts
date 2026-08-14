import { describe, expect, it, vi } from "vitest";
import {
  CapabilityTaskService,
  type CapabilityEvidenceProvider,
} from "../src/application/capability-task-service.js";
import type { CapabilityTaskPort } from "../src/contracts/index.js";
import type { ModelExecutionPort, ModelExecutionResult } from "../src/infrastructure/model-execution-port.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";

const input: Parameters<CapabilityTaskPort["enqueue"]>[0] = {
  trigger: "diagnostic_completed",
  sessionId: "session-1",
  profileRevision: 3,
  evidenceVersion: 1,
  evidenceIds: ["evidence-1"],
};

const evidence: CapabilityEvidenceProvider = {
  async load() {
    return [{ evidenceId: "evidence-1", observableDimensionIds: ["syntax_api", "cleaning_reasoning"], safeSummary: "Completed a deterministic selected-response activity." }];
  },
};

function response(payload: unknown): ModelExecutionResult {
  return { status: "ok", payload, sourceRefs: [], traceSummary: "recorded capability result", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
}

const partialPayload = {
  dimensions: [
    { id: "syntax_api", score: 80, confidence: 0.8, rationale: "正式活动证据显示基础API能力。", evidenceRefs: ["evidence-1"] },
    { id: "cleaning_reasoning", score: 70, confidence: 0.7, rationale: "正式活动证据显示清洗推理能力。", evidenceRefs: ["evidence-1"] },
  ],
};

function create(modelResult: ModelExecutionResult, provider: CapabilityEvidenceProvider = evidence, store = new InMemoryW4PrivateRuntimeStore()) {
  const port: ModelExecutionPort = { execute: vi.fn(async () => modelResult) };
  return { port, store, service: new CapabilityTaskService({
    modelExecutionPort: port, evidenceProvider: provider, privateStore: store,
    modelId: "deepseek-chat", promptVersion: "w4-d2-v1", now: () => new Date("2026-08-14T00:00:00.000Z"),
  }) };
}

describe("CapabilityTaskService", () => {
  it("queues only after the frozen trigger and writes a partial five-dimension snapshot", async () => {
    const { service } = create(response(partialPayload));
    await expect(service.enqueue(input)).resolves.toEqual({ taskStatus: "not_updated" });
    await service.waitForIdle();
    const snapshot = await service.getSnapshot(input.sessionId);
    expect(snapshot).toMatchObject({ evidenceVersion: 1, profileRevision: 3, status: "partial" });
    expect(snapshot?.dimensions).toHaveLength(5);
    expect(snapshot?.dimensions.filter((item) => item.state === "verified").map((item) => item.id))
      .toEqual(["syntax_api", "cleaning_reasoning"]);
    expect(snapshot?.dimensions.filter((item) => item.state === "unverified")).toHaveLength(3);
  });

  it("does not call the model when there is no observable evidence and marks all dimensions unverified", async () => {
    const empty: CapabilityEvidenceProvider = { load: vi.fn(async () => []) };
    const { service, port } = create(response(partialPayload), empty);
    await service.enqueue({ ...input, evidenceIds: [] }); await service.waitForIdle();
    expect(port.execute).not.toHaveBeenCalled();
    const snapshot = await service.getSnapshot(input.sessionId);
    expect(snapshot).toMatchObject({ status: "unverified" });
    expect(snapshot?.dimensions.every((item) => item.state === "unverified" && item.evidenceRefs.length === 0)).toBe(true);
  });

  it("preserves the old snapshot when a later provider task fails", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const first = create(response(partialPayload), evidence, store).service;
    await first.enqueue(input); await first.waitForIdle();
    const before = await first.getSnapshot(input.sessionId);

    const failed = create({ status: "provider_error", sourceRefs: [], traceSummary: "offline", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" }, evidence, store).service;
    await failed.enqueue({ ...input, trigger: "node_completed", evidenceVersion: 2 }); await failed.waitForIdle();
    expect(await failed.getSnapshot(input.sessionId)).toEqual(before);
    await expect(failed.getTask(input.sessionId, 2)).resolves.toMatchObject({ taskStatus: "failed", reasonCode: "provider_error" });
  });

  it("rejects authority-shaped or unbound model dimensions without changing a snapshot", async () => {
    const payloads = [
      { dimensions: partialPayload.dimensions, mastery: 1 },
      { dimensions: [{ ...partialPayload.dimensions[0], evidenceRefs: ["foreign-evidence"] }] },
    ];
    for (const payload of payloads) {
      const { service } = create(response(payload));
      await service.enqueue(input); await service.waitForIdle();
      expect(await service.getSnapshot(input.sessionId)).toBeUndefined();
      await expect(service.getTask(input.sessionId, 1)).resolves.toMatchObject({ taskStatus: "failed" });
    }
  });

  it("rejects an English-only capability rationale", async () => {
    const { service } = create(response({ dimensions: [
      { id: "syntax_api", score: 80, confidence: 0.8, rationale: "Observed only in English.", evidenceRefs: ["evidence-1"] },
    ] }));
    await service.enqueue(input); await service.waitForIdle();
    await expect(service.getTask(input.sessionId, 1)).resolves.toMatchObject({ taskStatus: "failed", reasonCode: "invalid_or_unbound_dimension" });
  });

  it("returns stale for an older event and never rolls back the newer snapshot", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const current = create(response(partialPayload), evidence, store).service;
    await current.enqueue({ ...input, evidenceVersion: 3 }); await current.waitForIdle();
    const before = await current.getSnapshot(input.sessionId);
    await expect(current.enqueue({ ...input, trigger: "node_completed", evidenceVersion: 2 })).resolves.toEqual({ taskStatus: "stale" });
    expect(await current.getSnapshot(input.sessionId)).toEqual(before);
  });

  it("serializes same-session jobs so a slower older event cannot overwrite the newer snapshot", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const { service } = create(response(partialPayload), evidence, store);
    await service.enqueue({ ...input, evidenceVersion: 2 });
    await service.enqueue({ ...input, evidenceVersion: 3 });
    await service.waitForIdle();
    await expect(service.getSnapshot(input.sessionId)).resolves.toMatchObject({ evidenceVersion: 3 });
    await expect(service.getTask(input.sessionId, 2)).resolves.toMatchObject({ taskStatus: "not_updated" });
  });

  it("retains verified dimensions from earlier learning units when a later unit observes another dimension", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const provider: CapabilityEvidenceProvider = {
      async load(request) {
        return request.evidenceVersion === 1
          ? [{ evidenceId: "evidence-1", observableDimensionIds: ["syntax_api"], safeSummary: "Formal first unit." }]
          : [{ evidenceId: "evidence-2", observableDimensionIds: ["validation_debugging"], safeSummary: "Formal second unit." }];
      },
    };
    const first = create(response({ dimensions: [{ id: "syntax_api", score: 80, confidence: 0.8, rationale: "首次正式证据。", evidenceRefs: ["evidence-1"] }] }), provider, store).service;
    await first.enqueue({ ...input, evidenceIds: ["evidence-1"] }); await first.waitForIdle();
    const second = create(response({ dimensions: [{ id: "validation_debugging", score: 75, confidence: 0.8, rationale: "第二次正式证据。", evidenceRefs: ["evidence-2"] }] }), provider, store).service;
    await second.enqueue({ ...input, trigger: "node_completed", evidenceVersion: 2, evidenceIds: ["evidence-2"] }); await second.waitForIdle();
    const snapshot = await second.getSnapshot(input.sessionId);
    expect(snapshot?.dimensions.find((item) => item.id === "syntax_api")?.state).toBe("verified");
    expect(snapshot?.dimensions.find((item) => item.id === "validation_debugging")?.state).toBe("verified");
  });
});
