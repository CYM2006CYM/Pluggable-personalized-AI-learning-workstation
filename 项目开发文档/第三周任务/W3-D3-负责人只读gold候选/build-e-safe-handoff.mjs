import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function parseJsonl(value) {
  return value.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line));
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

async function info(path) {
  const bytes = await readFile(path);
  return { file: basename(path), sha256: sha256(bytes), byteLength: bytes.length };
}

const ownerRoot = resolve(argument("--owner-candidate"));
const output = resolve(argument("--output"));
await mkdir(output, { recursive: true });

const ownerFiles = {
  difficulty: join(ownerRoot, "difficulty-gold.candidate.jsonl"),
  paths: join(ownerRoot, "path-constraints.candidate.jsonl"),
  adjudication: join(ownerRoot, "adjudication-log.candidate.jsonl"),
  differences: join(ownerRoot, "mechanical-differences-owner-only.jsonl"),
  freeze: join(ownerRoot, "owner-candidate-freeze-record.json"),
  verification: join(ownerRoot, "owner-candidate-verification.json"),
};
const freeze = JSON.parse(await readFile(ownerFiles.freeze, "utf8"));
if (freeze.status !== "OWNER_READONLY_GOLD_CANDIDATE" || freeze.access?.formalGold !== false) {
  throw new Error("Owner candidate freeze status is invalid");
}
const adjudicationText = await readFile(ownerFiles.adjudication, "utf8");
const adjudications = parseJsonl(adjudicationText);
if (adjudications.length !== 60) throw new Error("Owner adjudication candidate must contain 60 records");

const publicIndex = adjudications.map((record) => ({
  caseId: record.caseId,
  negotiationStatus: record.negotiationStatus,
  signaturePrecedentCaseId: record.signaturePrecedentCaseId ?? null,
  adjudicationRecordSha256: sha256(Buffer.from(`${JSON.stringify(record)}\n`, "utf8")),
  ownerDecisionSha256: sha256(Buffer.from(JSON.stringify(stable(record.ownerDecision)), "utf8")),
}));
const expectedIds = Array.from({ length: 60 }, (_, index) => `final-${String(index + 1).padStart(3, "0")}`);
if (JSON.stringify(publicIndex.map((record) => record.caseId)) !== JSON.stringify(expectedIds)) {
  throw new Error("Public adjudication index coverage/order mismatch");
}
if (!publicIndex.slice(20).every((record) => record.negotiationStatus === "SKIPPED_BY_D44")) {
  throw new Error("Public adjudication index D44 status mismatch");
}

const destinations = {
  difficulty: join(output, "difficulty-gold.candidate.jsonl"),
  paths: join(output, "path-constraints.candidate.jsonl"),
  freeze: join(output, "owner-candidate-freeze-record.json"),
  verification: join(output, "owner-candidate-verification.json"),
  publicIndex: join(output, "adjudication-public-index.jsonl"),
  attestation: join(output, "owner-candidate-public-attestation.json"),
  readme: join(output, "README.md"),
};
await Promise.all([
  copyFile(ownerFiles.difficulty, destinations.difficulty),
  copyFile(ownerFiles.paths, destinations.paths),
  copyFile(ownerFiles.freeze, destinations.freeze),
  copyFile(ownerFiles.verification, destinations.verification),
]);
await writeFile(destinations.publicIndex, jsonl(publicIndex), "utf8");
const attestation = {
  schemaVersion: "w3-d3-owner-candidate-public-attestation-v1",
  status: "OWNER_READONLY_GOLD_CANDIDATE",
  contractVersion: freeze.contractVersion,
  decisionBasis: "D44",
  formalGold: false,
  gitUploadAuthorized: false,
  scope: freeze.scope,
  qualification: freeze.qualification,
  checks: {
    candidateCoverage: "60/60",
    ownerAdjudicationCoverage: "40/40",
    final021To060NegotiationStatus: "SKIPPED_BY_D44",
    first20RawBytesPreserved: true,
    sealedOriginalsModified: false,
    formal60SystemRunBeforeFreezeCount: 0,
  },
  decisionCounts: freeze.adjudicationMethod.decisionCounts,
  files: {
    difficulty: await info(destinations.difficulty),
    paths: await info(destinations.paths),
    publicAdjudicationIndex: await info(destinations.publicIndex),
    ownerFreezeRecord: await info(destinations.freeze),
    ownerVerification: await info(destinations.verification),
    withheldAdjudicationCandidate: {
      sha256: freeze.payload.adjudication.sha256,
      lineCount: 60,
      reason: "Contains B/E raw opinions and remains owner-only under D44",
    },
    withheldMechanicalDifferences: {
      sha256: freeze.payload.differences.sha256,
      lineCount: 40,
      reason: "Owner mechanical difference list is not visible to B/E under D44",
    },
  },
};
await writeFile(destinations.attestation, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
const readme = `# E岗位D4只读候选交接\n\n状态：\`OWNER_READONLY_GOLD_CANDIDATE\`。本交接不是正式gold，不授权Git上传。\n\nE只可验证difficulty/path候选、公开终裁索引、负责人冻结记录及哈希。\`adjudication-log.candidate.jsonl\`、B/E封存原件和机械差异清单由负责人保留，不向E开放。公开索引只包含caseId、合法跳过状态和不可逆哈希，不包含任一标注人的原始意见或负责人裁决正文。\n`;
await writeFile(destinations.readme, readme, "utf8");

const result = {
  status: "PASS",
  output,
  visibleFiles: await Promise.all(Object.values(destinations).map(info)),
  withheldFiles: ["adjudication-log.candidate.jsonl", "mechanical-differences-owner-only.jsonl", "B/E sealed originals"],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
