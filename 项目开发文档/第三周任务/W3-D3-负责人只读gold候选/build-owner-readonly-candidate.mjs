import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const CONTRACT_VERSION = "W3-C5/W3-R2";
const OWNER_STATUS = "OWNER_READONLY_GOLD_CANDIDATE";
const EXPECTED_CASE_IDS = Array.from({ length: 40 }, (_, index) => `final-${String(index + 21).padStart(3, "0")}`);
const ALLOWED_FORBIDDEN_ACTIONS = new Set([
  "skip_unverified_prerequisite",
  "omit_required_node",
  "violate_prerequisite_order",
  "exceed_time_budget",
]);

function parseArguments(argv) {
  const result = { mode: "build" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--verify") {
      result.mode = "verify";
      continue;
    }
    if (!value.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${value}`);
    }
    result[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const required of ["repository", "e-annotations", "output"]) {
    if (!result[required]) throw new Error(`Missing --${required}`);
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedText(value) {
  return value.replace(/\r\n?/gu, "\n");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function parseJsonl(text, label) {
  const lines = normalizedText(text).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    if (!line.trim()) throw new Error(`${label}:${index + 1} is blank`);
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${label}:${index + 1} is invalid JSON`);
    }
  });
}

function toJsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inputSignature(record) {
  return stableJson({
    goalId: record.goalId,
    availableMinutes: record.availableMinutes,
    diagnosticAnswers: record.diagnosticAnswers,
  });
}

function opinionCore(record) {
  return {
    nodeConstraints: record.nodeConstraints,
    requiredRemediationKnowledgePointIds: record.requiredRemediationKnowledgePointIds,
    forbiddenActions: [...record.forbiddenActions].sort(),
  };
}

function validateAnnotation(record, role, expectedCaseId) {
  assert(record.caseId === expectedCaseId, `${role} case order mismatch: ${record.caseId} != ${expectedCaseId}`);
  assert(record.annotatorRole === role, `${expectedCaseId} annotatorRole must be ${role}`);
  assert(Array.isArray(record.nodeConstraints), `${expectedCaseId} nodeConstraints missing`);
  assert(Array.isArray(record.requiredRemediationKnowledgePointIds), `${expectedCaseId} remediation missing`);
  assert(Array.isArray(record.forbiddenActions), `${expectedCaseId} forbiddenActions missing`);
  assert(typeof record.notes === "string", `${expectedCaseId} notes missing`);
  for (const action of record.forbiddenActions) {
    assert(ALLOWED_FORBIDDEN_ACTIONS.has(action), `${expectedCaseId} invalid forbidden action: ${action}`);
  }
  const nodeIds = record.nodeConstraints.map((item) => item.knowledgePointId);
  assert(new Set(nodeIds).size === nodeIds.length, `${expectedCaseId} duplicate node constraint`);
  for (const item of record.nodeConstraints) {
    assert(typeof item.knowledgePointId === "string", `${expectedCaseId} invalid knowledgePointId`);
    assert(typeof item.required === "boolean", `${expectedCaseId} invalid required`);
    assert(Array.isArray(item.allowedDifficulties) && item.allowedDifficulties.length > 0, `${expectedCaseId} invalid difficulties`);
    assert(Array.isArray(item.allowedScaffoldLevels) && item.allowedScaffoldLevels.length > 0, `${expectedCaseId} invalid scaffolds`);
    assert(typeof item.skippable === "boolean", `${expectedCaseId} invalid skippable`);
  }
}

function collectDifferences(left, right, path = "$") {
  if (stableJson(left) === stableJson(right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const differences = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      differences.push(...collectDifferences(left[index], right[index], `${path}[${index}]`));
    }
    return differences;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => collectDifferences(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, bValue: left ?? null, eValue: right ?? null }];
}

async function fileInfo(path, lineCount) {
  const bytes = await readFile(path);
  return {
    file: basename(path),
    sha256: sha256(bytes),
    byteLength: bytes.length,
    lineCount,
  };
}

async function loadInputs(options) {
  const repository = resolve(options.repository);
  const goldenRoot = join(repository, "evaluation", "golden");
  const paths = {
    final60: join(repository, "evaluation", "personas", "final-60.jsonl"),
    bAnnotations: join(goldenRoot, "annotations", "b-final-021-060.jsonl"),
    qualification: join(goldenRoot, "annotations", "audit", "w3-d1-dual-seal-qualification.json"),
    difficulty20: join(goldenRoot, "difficulty-gold.jsonl"),
    path20: join(goldenRoot, "path-constraints.jsonl"),
    adjudication20: join(goldenRoot, "adjudication-log.jsonl"),
    eAnnotations: resolve(options["e-annotations"]),
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, path, await readFile(path)]));
  const bytes = Object.fromEntries(entries.map(([key, , value]) => [key, value]));
  const texts = Object.fromEntries(entries.map(([key, , value]) => [key, value.toString("utf8")]));
  const qualification = JSON.parse(texts.qualification);
  assert(qualification.qualificationStatus === "PASS", "Dual-seal qualification is not PASS");
  assert(qualification.decisionBasis === "D44", "Qualification is not bound to D44");
  assert(qualification.checks?.schemaValid === true, "Qualification schema check failed");
  assert(qualification.checks?.coverage40Of40 === true, "Qualification coverage check failed");
  assert(qualification.checks?.sameFrozenInput === true, "Qualification input binding failed");
  assert(qualification.checks?.sealHashesVerified === true, "Qualification seal verification failed");
  assert(qualification.checks?.independenceQualified === true, "Qualification independence failed");
  assert(sha256(Buffer.from(normalizedText(texts.final60), "utf8")) === qualification.frozenInput.sha256, "final-60 normalized hash mismatch");
  assert(sha256(Buffer.from(normalizedText(texts.bAnnotations), "utf8")) === qualification.bSeal.annotationSha256, "B normalized annotation hash mismatch");
  assert(sha256(bytes.eAnnotations) === qualification.eSeal.annotationSha256, "E raw annotation hash mismatch");
  return {
    repository,
    paths,
    bytes,
    texts,
    qualification,
    final60: parseJsonl(texts.final60, "final-60"),
    bAnnotations: parseJsonl(texts.bAnnotations, "B annotations"),
    eAnnotations: parseJsonl(texts.eAnnotations, "E annotations"),
    difficulty20: parseJsonl(texts.difficulty20, "difficulty gold W2"),
    path20: parseJsonl(texts.path20, "path constraints W2"),
    adjudication20: parseJsonl(texts.adjudication20, "adjudication W2"),
  };
}

function buildRecords(inputs) {
  assert(inputs.final60.length === 60, "final-60 must contain 60 records");
  assert(inputs.bAnnotations.length === 40 && inputs.eAnnotations.length === 40, "B/E annotations must contain 40 records each");
  assert(inputs.difficulty20.length === 20 && inputs.path20.length === 20 && inputs.adjudication20.length === 20, "W2 gold must contain 20 records per file");
  inputs.bAnnotations.forEach((record, index) => validateAnnotation(record, "B", EXPECTED_CASE_IDS[index]));
  inputs.eAnnotations.forEach((record, index) => validateAnnotation(record, "E", EXPECTED_CASE_IDS[index]));

  const finalById = new Map(inputs.final60.map((record) => [record.caseId, record]));
  const signatureGroups = new Map();
  for (const record of inputs.final60.slice(0, 20)) {
    const key = inputSignature(record);
    if (!signatureGroups.has(key)) signatureGroups.set(key, []);
    signatureGroups.get(key).push(record.caseId);
  }
  assert(signatureGroups.size === 5, `Expected 5 frozen input signatures, got ${signatureGroups.size}`);

  const priorAdjudicationById = new Map(inputs.adjudication20.map((record) => [record.caseId, record]));
  const priorDifficultyById = new Map(inputs.difficulty20.map((record) => [record.caseId, record]));
  const priorPathById = new Map(inputs.path20.map((record) => [record.caseId, record]));
  const representatives = new Map();
  for (const [signature, caseIds] of signatureGroups) {
    const adjudications = caseIds.map((caseId) => priorAdjudicationById.get(caseId));
    assert(adjudications.every(Boolean), `Missing W2 adjudication for signature ${signature}`);
    const first = adjudications[0];
    for (const record of adjudications.slice(1)) {
      assert(stableJson(opinionCore(record.bOpinion)) === stableJson(opinionCore(first.bOpinion)), `W2 B opinion drift in signature ${signature}`);
      assert(stableJson(opinionCore(record.eOpinion)) === stableJson(opinionCore(first.eOpinion)), `W2 E opinion drift in signature ${signature}`);
      assert(stableJson(opinionCore(record.ownerDecision)) === stableJson(opinionCore(first.ownerDecision)), `W2 owner decision drift in signature ${signature}`);
      assert(record.ownerDecision.decisionType === first.ownerDecision.decisionType, `W2 decision type drift in signature ${signature}`);
      assert(record.reason === first.reason, `W2 reason drift in signature ${signature}`);
    }
    representatives.set(signature, {
      caseId: caseIds[0],
      adjudication: first,
      difficulty: priorDifficultyById.get(caseIds[0]),
      path: priorPathById.get(caseIds[0]),
    });
  }

  const mechanicalDifferences = [];
  const pendingAdjudications = [];
  const appendedDifficulty = [];
  const appendedPaths = [];
  const decisionCounts = {};
  for (let index = 0; index < EXPECTED_CASE_IDS.length; index += 1) {
    const caseId = EXPECTED_CASE_IDS[index];
    const input = finalById.get(caseId);
    const bOpinion = inputs.bAnnotations[index];
    const eOpinion = inputs.eAnnotations[index];
    const representative = representatives.get(inputSignature(input));
    assert(representative, `${caseId} has no W2 frozen-signature precedent`);
    assert(stableJson(opinionCore(bOpinion)) === stableJson(opinionCore(representative.adjudication.bOpinion)), `${caseId} B opinion does not match frozen-signature precedent`);
    assert(stableJson(opinionCore(eOpinion)) === stableJson(opinionCore(representative.adjudication.eOpinion)), `${caseId} E opinion does not match frozen-signature precedent`);
    const differences = collectDifferences(opinionCore(bOpinion), opinionCore(eOpinion));
    mechanicalDifferences.push({
      caseId,
      signaturePrecedentCaseId: representative.caseId,
      differenceCount: differences.length,
      differences,
    });
    const ownerDecision = structuredClone(representative.adjudication.ownerDecision);
    decisionCounts[ownerDecision.decisionType] = (decisionCounts[ownerDecision.decisionType] ?? 0) + 1;
    pendingAdjudications.push({
      caseId,
      sourceHashes: null,
      negotiationStatus: "SKIPPED_BY_D44",
      signaturePrecedentCaseId: representative.caseId,
      bOpinion,
      eOpinion,
      ownerDecision,
      reason: `本例冻结诊断、目标和预算与${representative.caseId}同签名，B/E结构化意见分别复现该签名的既有双标模式；沿用已冻结预裁口径。${representative.adjudication.reason}`,
    });
    const difficulty = structuredClone(representative.difficulty);
    difficulty.caseId = caseId;
    assert(stableJson(difficulty.nodeConstraints) === stableJson(ownerDecision.nodeConstraints), `${caseId} difficulty projection mismatch`);
    appendedDifficulty.push(difficulty);
    const path = structuredClone(representative.path);
    path.caseId = caseId;
    assert(path.goalId === input.goalId && path.availableMinutes === input.availableMinutes, `${caseId} path input projection mismatch`);
    assert(stableJson(path.requiredRemediationKnowledgePointIds) === stableJson(ownerDecision.requiredRemediationKnowledgePointIds), `${caseId} remediation projection mismatch`);
    assert(stableJson([...path.forbiddenActions].sort()) === stableJson([...ownerDecision.forbiddenActions].sort()), `${caseId} forbidden-action projection mismatch`);
    appendedPaths.push(path);
  }
  return { mechanicalDifferences, pendingAdjudications, appendedDifficulty, appendedPaths, decisionCounts, signatureCount: signatureGroups.size };
}

async function writeBuild(options, inputs, records) {
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  const files = {
    differences: join(output, "mechanical-differences-owner-only.jsonl"),
    difficulty: join(output, "difficulty-gold.candidate.jsonl"),
    paths: join(output, "path-constraints.candidate.jsonl"),
    adjudication: join(output, "adjudication-log.candidate.jsonl"),
    freeze: join(output, "owner-candidate-freeze-record.json"),
    verification: join(output, "owner-candidate-verification.json"),
  };
  await writeFile(files.differences, toJsonl(records.mechanicalDifferences), "utf8");
  const differencesHash = sha256(await readFile(files.differences));
  const qualificationHash = sha256(inputs.bytes.qualification);
  const sourceHashes = {
    frozenInputNormalizedSha256: inputs.qualification.frozenInput.sha256,
    bAnnotationNormalizedSha256: inputs.qualification.bSeal.annotationSha256,
    eAnnotationRawSha256: inputs.qualification.eSeal.annotationSha256,
    mechanicalDifferencesSha256: differencesHash,
    dualSealQualificationSha256: qualificationHash,
  };
  const appendedAdjudications = records.pendingAdjudications.map((record) => ({ ...record, sourceHashes }));
  await writeFile(files.difficulty, Buffer.concat([inputs.bytes.difficulty20, Buffer.from(toJsonl(records.appendedDifficulty), "utf8")]));
  await writeFile(files.paths, Buffer.concat([inputs.bytes.path20, Buffer.from(toJsonl(records.appendedPaths), "utf8")]));
  await writeFile(files.adjudication, Buffer.concat([inputs.bytes.adjudication20, Buffer.from(toJsonl(appendedAdjudications), "utf8")]));
  const payload = {
    difficulty: await fileInfo(files.difficulty, 60),
    paths: await fileInfo(files.paths, 60),
    adjudication: await fileInfo(files.adjudication, 60),
    differences: await fileInfo(files.differences, 40),
  };
  const freeze = {
    schemaVersion: "w3-d3-owner-readonly-gold-candidate-v1",
    recordType: "owner_readonly_gold_candidate_freeze",
    status: OWNER_STATUS,
    contractVersion: CONTRACT_VERSION,
    decisionBasis: "D44",
    baseCommit: "bd1b599524ef2e3362d14a422d97debbf240f70f",
    createdAt: new Date().toISOString(),
    scope: { firstCaseId: "final-001", lastCaseId: "final-060", totalCaseCount: 60, newlyAdjudicatedCaseCount: 40 },
    qualification: {
      status: inputs.qualification.qualificationStatus,
      sha256: qualificationHash,
      qualifiedAt: inputs.qualification.qualifiedAt,
    },
    sourceHashes,
    adjudicationMethod: {
      kind: "FROZEN_INPUT_SIGNATURE_PRECEDENT",
      signatureCount: records.signatureCount,
      description: "目标、预算和诊断答案同签名时复用W2已冻结负责人裁决；B/E结构化意见必须分别复现同签名既有双标模式，否则停止生成。",
      decisionCounts: records.decisionCounts,
    },
    payload,
    checks: {
      dualSealQualificationPass: true,
      schemaValid: true,
      coverage60Of60: true,
      stableCaseOrder: true,
      first20RawBytesPreserved: true,
      final021To060NegotiationStatus: "SKIPPED_BY_D44",
      sealedOriginalsModified: false,
      formal60SystemRunBeforeFreezeCount: 0,
    },
    access: {
      readonlyCandidate: true,
      formalGold: false,
      gitUploadAuthorized: false,
      visibleToE: "candidate payload and freeze hashes only",
      hiddenFromE: ["B/E sealed originals", "mechanical differences", "owner working notes"],
    },
  };
  await writeFile(files.freeze, `${JSON.stringify(freeze, null, 2)}\n`, "utf8");
  const verification = await verifyOutput(options, inputs, { quiet: true });
  await writeFile(files.verification, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  return { files, freeze, verification };
}

async function verifyOutput(options, inputs, { quiet = false } = {}) {
  const output = resolve(options.output);
  const names = {
    difficulty: "difficulty-gold.candidate.jsonl",
    paths: "path-constraints.candidate.jsonl",
    adjudication: "adjudication-log.candidate.jsonl",
    differences: "mechanical-differences-owner-only.jsonl",
    freeze: "owner-candidate-freeze-record.json",
  };
  const values = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => {
    const path = join(output, name);
    return [key, { path, bytes: await readFile(path) }];
  })));
  const difficulty = parseJsonl(values.difficulty.bytes.toString("utf8"), names.difficulty);
  const paths = parseJsonl(values.paths.bytes.toString("utf8"), names.paths);
  const adjudication = parseJsonl(values.adjudication.bytes.toString("utf8"), names.adjudication);
  const differences = parseJsonl(values.differences.bytes.toString("utf8"), names.differences);
  const freeze = JSON.parse(values.freeze.bytes.toString("utf8"));
  const expected60 = Array.from({ length: 60 }, (_, index) => `final-${String(index + 1).padStart(3, "0")}`);
  for (const records of [difficulty, paths, adjudication]) {
    assert(records.length === 60, "Candidate gold file must contain 60 records");
    assert(stableJson(records.map((record) => record.caseId)) === stableJson(expected60), "Candidate case coverage/order mismatch");
  }
  assert(differences.length === 40, "Mechanical difference list must contain 40 records");
  assert(stableJson(differences.map((record) => record.caseId)) === stableJson(EXPECTED_CASE_IDS), "Mechanical difference coverage/order mismatch");
  assert(adjudication.slice(20).every((record) => record.negotiationStatus === "SKIPPED_BY_D44"), "D44 negotiation status mismatch");
  assert(inputs.bytes.difficulty20.equals(values.difficulty.bytes.subarray(0, inputs.bytes.difficulty20.length)), "W2 difficulty bytes changed");
  assert(inputs.bytes.path20.equals(values.paths.bytes.subarray(0, inputs.bytes.path20.length)), "W2 path bytes changed");
  assert(inputs.bytes.adjudication20.equals(values.adjudication.bytes.subarray(0, inputs.bytes.adjudication20.length)), "W2 adjudication bytes changed");
  assert(freeze.status === OWNER_STATUS && freeze.contractVersion === CONTRACT_VERSION, "Freeze status/contract mismatch");
  for (const key of ["difficulty", "paths", "adjudication", "differences"]) {
    assert(freeze.payload[key].sha256 === sha256(values[key].bytes), `${key} freeze hash mismatch`);
  }
  const result = {
    schemaVersion: "w3-d3-owner-candidate-verification-v1",
    status: "PASS",
    verifiedAt: new Date().toISOString(),
    checks: {
      jsonParse: "220/220 + freeze record",
      candidateCoverage: "60/60 x 3",
      differenceCoverage: "40/40",
      first20RawBytesPreserved: true,
      d44NegotiationStatus: "40/40",
      freezePayloadHashes: "4/4",
      formalGold: false,
      gitUploadAuthorized: false,
    },
    files: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { file: basename(value.path), sha256: sha256(value.bytes), byteLength: value.bytes.length }])),
  };
  if (!quiet) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const output = resolve(options.output);
  if (options.mode === "build") {
    try {
      const outputStat = await stat(output);
      assert(outputStat.isDirectory(), "Output exists and is not a directory");
      const entries = ["difficulty-gold.candidate.jsonl", "path-constraints.candidate.jsonl", "adjudication-log.candidate.jsonl"];
      for (const name of entries) {
        try {
          await stat(join(output, name));
          throw new Error(`Refusing to overwrite frozen candidate: ${name}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const inputs = await loadInputs(options);
  if (options.mode === "verify") {
    await verifyOutput(options, inputs);
    return;
  }
  const records = buildRecords(inputs);
  const result = await writeBuild(options, inputs, records);
  process.stdout.write(`${JSON.stringify({ status: "PASS", output, decisionCounts: records.decisionCounts, payload: result.freeze.payload }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
