import { createHash } from "node:crypto";
import { parseSafeAgentRunView, type SafeAgentRunExport, type SafeAgentRunView } from "../contracts/index.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function createSafeAgentRunExport(run: SafeAgentRunView, exportedAt: string): SafeAgentRunExport {
  if (!Number.isFinite(Date.parse(exportedAt))) throw new TypeError("exportedAt must be an ISO timestamp");
  const payload = { schemaVersion: 1 as const, exportedAt, run: parseSafeAgentRunView(run) };
  return { ...payload, exportSha256: hash(payload) };
}

export function parseSafeAgentRunExport(value: unknown): SafeAgentRunExport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Agent run export must be an object");
  const candidate = value as SafeAgentRunExport;
  const parsed = createSafeAgentRunExport(candidate.run, candidate.exportedAt);
  if (candidate.schemaVersion !== 1 || candidate.exportSha256 !== parsed.exportSha256) throw new TypeError("Agent run export hash mismatch");
  return parsed;
}
