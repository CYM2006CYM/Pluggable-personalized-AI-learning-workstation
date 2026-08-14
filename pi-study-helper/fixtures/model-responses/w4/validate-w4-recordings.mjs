import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("fixtures/model-responses/w4");
const raw = await readFile(resolve(root, "recorded-responses.json"), "utf8");
const value = JSON.parse(raw);
if (!value || !Array.isArray(value.recordings)) throw new Error("recordings array is required");
const recordings = value.recordings;
const capabilityRationalesAreChinese = recordings
  .filter((item) => item.graphId === "capability-scorer" && item.status === "ok")
  .every((item) => Array.isArray(item.payload?.dimensions)
    && item.payload.dimensions.every((dimension) => typeof dimension.rationale === "string"
      && /[\u3400-\u9fff]/u.test(dimension.rationale)));
const required = {
  success: recordings.some((item) => item.status === "ok" && item.traceSummary?.includes("RECORDED_PASS")),
  invalidSchema: recordings.some((item) => item.status === "invalid_output"),
  timeout: recordings.some((item) => item.status === "timeout"),
  providerError: recordings.some((item) => item.status === "provider_error"),
  highRiskReview: ["generator", "hunter", "defender", "judge"].every((role) => recordings.some((item) => item.graphId === role && item.runId.startsWith("w4-high-risk."))),
  authorityRejection: recordings.some((item) => item.runId.includes("authority-rejected")),
  capability: recordings.some((item) => item.graphId === "capability-scorer"),
  capabilityRationalesAreChinese,
};
if (Object.values(required).some((result) => !result)) throw new Error(`recording coverage is incomplete: ${JSON.stringify(required)}`);
const forbidden = [
  /Authorization\s*:\s*Bearer/iu,
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:\\/u,
  /\\\\[^"\s]+\\/u,
  /\/(?:home|Users)\//u,
  /OPENAI_API_KEY\s*[:=]\s*[^"\]]/u,
  /w4-read-csv-f[1-4]/u,
];
const matches = forbidden.flatMap((pattern) => raw.match(pattern) ?? []);
if (matches.length > 0) throw new Error(`recording security scan failed: ${matches.length} matches`);
console.log(JSON.stringify({ status: "PASS", recordingCount: recordings.length, required, sensitiveMatches: 0,
  onlineModel: "LIVE_NOT_RUN", fallback: "MOCK_FALLBACK_USED" }, null, 2));
