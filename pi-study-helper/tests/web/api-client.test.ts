import { afterEach, describe, expect, it, vi } from "vitest";
import { api, isEvaluatorFailure, newRequestId } from "../../src/web/api/client.js";
import { bootstrap, fail, ok } from "./fixtures/w4-api.js";

describe("W4 Web API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps 200 and 202 safe response envelopes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bootstrap())).mockResolvedValueOnce(ok({ contentReadiness: "preparing" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    expect((await api.getBootstrap()).profiles[0]?.revision).toBe(3);
    await expect(api.getBootstrap()).resolves.toMatchObject({ contentReadiness: "preparing" });
  });

  it.each([[400, "invalid_request_shape"], [404, "session_not_found"], [409, "session_version_conflict"], [422, "submission_contract_error"], [500, "storage_error"], [503, "initialization_not_ready"]])("keeps HTTP %i as a typed safe error", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(status, code)));
    await expect(api.getBootstrap()).rejects.toEqual(expect.objectContaining({ status, code }));
  });

  it("sends session identifiers in resource paths, not duplicated request bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", fetchMock);
    await api.confirmPath({ requestId: "confirm", sessionId: "session-1", sessionVersion: 2, profileRevision: 3, pathId: "path-1", pathVersion: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/path/confirm", expect.objectContaining({ body: expect.not.stringContaining("sessionId") }));
  });

  it("recognizes evaluator failures as business results", () => {
    expect(isEvaluatorFailure({ status: "evaluator_error", errorCode: "evaluator_timeout", verdict: "not_graded" })).toBe(true);
    expect(newRequestId("web")).toMatch(/^web-/u);
  });
});
