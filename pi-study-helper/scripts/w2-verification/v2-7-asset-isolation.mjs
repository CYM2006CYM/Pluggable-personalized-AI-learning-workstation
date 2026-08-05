import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const V2_7_CATEGORIES = [
  "diagnostic_answers",
  "private_csv",
  "hidden_tests",
  "reference_implementations",
  "api_keys",
  "host_absolute_paths",
];

export const V2_7_SURFACES = [
  "safe_dto",
  "ordinary_log",
  "d_recording",
  "safe_export",
  "verification_report",
];

const builtInPatterns = {
  diagnostic_answers: /(correctanswer|answerkey|answer-key|correctoptionindex)/iu,
  private_csv: /(?:^|[\\/"'])private(?:[\\/][^\\/\s]+)*[\\/][^\\/\s]+\.csv(?=$|[\\/"',}\]\s])/iu,
  // A bare category name is not a hidden-test disclosure.  Only an actual
  // hidden-test path or file-like identifier is sensitive.  This prevents a
  // safe DTO's explicit prohibition declaration from becoming a false leak.
  hidden_tests: /(?:^|[\\/"'])(?:[^\\/"'\s]+[\\/])?hidden[ _-]?tests?(?:[\\/][^\\/\s]+|\.(?:py|js|mjs|cjs|ts|tsx))|(?:^|[\\/"'])test-[a-z0-9_-]*hidden(?:\.(?:py|js|mjs|cjs|ts|tsx)|[\\/])/iu,
  reference_implementations: /(?:^|[\\/"'])reference-solutions(?:[\\/][^\\/\s]+)*[\\/][^\\/\s]+\.(?:py|js|ts)(?=$|[\\/"',}\]\s])/iu,
  api_keys: /(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/u,
  host_absolute_paths: /(?:[A-Z]:[\\/]|file:\/\/|\/(?:Users|home|root)\/)/iu,
};

function emptyCounts() {
  return Object.fromEntries(V2_7_CATEGORIES.map((category) => [category, 0]));
}

function addTextMatches(text, counts, canaries) {
  for (const category of V2_7_CATEGORIES) {
    if (builtInPatterns[category].test(text)) counts[category] += 1;
    for (const canary of canaries[category]) {
      if (text.includes(canary)) counts[category] += 1;
    }
  }
}

export function validateV27Canaries(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("canary file must be a JSON object");
  }
  const result = {};
  for (const [category, entries] of Object.entries(value)) {
    if (!V2_7_CATEGORIES.includes(category)) throw new Error(`unknown canary category: ${category}`);
    if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      throw new Error(`canary category ${category} must be a non-empty array of non-empty strings`);
    }
    result[category] = entries;
  }
  for (const category of V2_7_CATEGORIES) {
    if (!Object.hasOwn(result, category)) throw new Error(`canary file is missing required category: ${category}`);
  }
  return result;
}

export async function scanV27({ inputs, canaryFile } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("at least one --input file is required");
  if (typeof canaryFile !== "string" || canaryFile.length === 0) throw new Error("a six-category --canary-file is required");
  const canaries = validateV27Canaries(JSON.parse(await readFile(canaryFile, "utf8")));
  const counts = emptyCounts();
  const inputFingerprints = [];
  const inputResults = [];
  const outputLocations = [];
  for (const [position, input] of inputs.entries()) {
    const inputPath = typeof input === "string" ? input : input.path;
    const outputLocation = typeof input === "string" ? `input-${position + 1}` : input.outputLocation;
    const surface = typeof input === "string" ? undefined : input.surface;
    if (typeof inputPath !== "string" || typeof outputLocation !== "string" || typeof surface !== "string") {
      throw new Error("each input requires a file path, normalized output location and declared surface");
    }
    if (!V2_7_SURFACES.includes(surface)) throw new Error(`input surface is not permitted by V2-7: ${surface}`);
    if (!isNormalizedRelativeLocation(outputLocation)) {
      throw new Error("--output-location must be a normalized relative path without '..' or host absolute paths");
    }
    const inputStat = await stat(inputPath);
    if (!inputStat.isFile()) throw new Error("--input accepts files only; directories are forbidden");
    const bytes = await readFile(inputPath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const inputCounts = emptyCounts();
    addTextMatches(text, inputCounts, canaries);
    for (const category of V2_7_CATEGORIES) counts[category] += inputCounts[category];
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    inputFingerprints.push(fingerprint);
    outputLocations.push({ position: position + 1, outputLocation, surface });
    // Only normalized locations and hashes are recorded: never host paths or
    // matched sensitive bodies.  This gives the owner actionable attribution.
    inputResults.push({ position: position + 1, outputLocation, surface, sha256: fingerprint, counts: inputCounts });
  }
  const hitCount = Object.values(counts).reduce((total, count) => total + count, 0);
  return {
    verification: "V2-7",
    scannerVersion: "w2-v2-7-asset-isolation-v1",
    inputCount: inputs.length,
    outputLocations,
    inputFingerprints,
    inputResults,
    counts,
    status: hitCount === 0 ? "PASS" : "BLOCKED",
  };
}

function isNormalizedRelativeLocation(value) {
  return value.length > 0
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split("/").includes("..");
}

function usage() {
  console.log("Usage: node v2-7-asset-isolation.mjs --input <safe-output-file> --output-location <normalized-relative-path> --surface <safe_dto|ordinary_log|d_recording|safe_export|verification_report> [--input ...] --canary-file <six-category-json> | --self-test");
}

async function selfTest() {
  const clean = emptyCounts();
  const canaries = Object.fromEntries(V2_7_CATEGORIES.map((category) => [category, [`__${category}_CANARY__`]]));
  addTextMatches('{"status":"safe"}', clean, validateV27Canaries(canaries));
  const hostile = emptyCounts();
  addTextMatches('{"correctAnswer":"canary","path":"private/example.csv"}', hostile, validateV27Canaries(canaries));
  const hostileNested = emptyCounts();
  addTextMatches('{"privateCsv":"private/datasets/example.csv","reference":"reference-solutions/nested/solution.py","testPath":"hidden_tests/test-private.py"}', hostileNested, validateV27Canaries(canaries));
  const safeDeclaration = emptyCounts();
  addTextMatches('{"forbiddenCategories":["hidden_tests"]}', safeDeclaration, validateV27Canaries(canaries));
  const canaryHits = emptyCounts();
  addTextMatches(JSON.stringify(canaries), canaryHits, validateV27Canaries(canaries));
  if (
    Object.values(clean).some((count) => count !== 0)
    || hostile.diagnostic_answers === 0
    || hostile.private_csv === 0
    || hostileNested.private_csv === 0
    || hostileNested.reference_implementations === 0
    || hostileNested.hidden_tests === 0
    || safeDeclaration.hidden_tests !== 0
    || Object.values(canaryHits).some((count) => count === 0)
  ) {
    throw new Error("scanner self-test failed");
  }
  console.log("V2-7 scanner self-test PASS");
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return usage();
  const inputs = [];
  let canaryFile;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") inputs.push({ path: argv[++index], outputLocation: `input-${inputs.length + 1}`, surface: null });
    else if (arg === "--output-location") {
      if (inputs.length === 0) throw new Error("--output-location must follow an --input");
      inputs[inputs.length - 1].outputLocation = argv[++index];
    }
    else if (arg === "--surface") {
      if (inputs.length === 0) throw new Error("--surface must follow an --input");
      inputs[inputs.length - 1].surface = argv[++index];
    }
    else if (arg === "--canary-file") canaryFile = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
    if (argv[index] === undefined) throw new Error(`missing value for ${arg}`);
  }
  const result = await scanV27({ inputs, canaryFile });
  console.log(JSON.stringify(result));
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`V2-7 scanner BLOCKED: ${error.message}`);
    process.exitCode = 2;
  });
}
