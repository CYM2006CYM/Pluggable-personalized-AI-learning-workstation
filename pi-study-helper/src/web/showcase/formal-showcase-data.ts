import formalShowcaseRaw from "./formal-showcase-data.json?raw";

const FORMAL_SEAL = "ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d";
const FORMAL_CASE_IDS = new Set([
  "showcase-high-foundation",
  "showcase-non-computer-beginner",
  "showcase-practice-oriented",
]);

export interface FormalPathNode {
  nodeId: string;
  knowledgePointId: string;
  activityIds: string[];
  status: string;
  estimatedMinutes: number;
  reasonCodes: string[];
  difficulty: string;
  scaffold: string;
  required: boolean;
  positionLocked: boolean;
}

export interface FormalShowcase {
  contract: "W5-C1/W5-R1";
  input: { caseId: string; path: string; byteLength: number; sha256: string };
  profileBinding: { subjectId: string; profileRevision: number; assetTreeSha256: string };
  semantic: {
    caseId: string;
    personaType: string;
    background: Record<string, string>;
    diagnostic: {
      insufficientKnowledgePointIds: string[];
      knowledgeStates: Array<{ knowledgePointId: string; mastery: number | null; status: string }>;
    };
    path: { status: string; pathVersion: number; nodes: FormalPathNode[] };
    nextStep: { completed: boolean; nodeId?: string; activityId?: string; contentReadiness?: string };
  };
  pathSha256: string;
  outputSha256: string;
}

export interface FormalDifferencePair {
  leftCaseId: string;
  rightCaseId: string;
  differenceCount: number;
  differences: Array<{ observable: string; key: string; left: unknown; right: unknown }>;
}

function parseFormalInputs(): { showcases: FormalShowcase[]; differences: FormalDifferencePair[] } {
  const generated = JSON.parse(formalShowcaseRaw) as {
    schemaVersion?: number;
    pathResults?: { status?: string; results?: FormalShowcase[] };
    differences?: { status?: string; pairs?: FormalDifferencePair[] };
  };
  const pathDocument = generated.pathResults ?? {};
  const differenceDocument = generated.differences ?? {};
  const showcases = pathDocument.results ?? [];
  const differences = differenceDocument.pairs ?? [];
  const valid = generated.schemaVersion === 1
    && pathDocument.status === "PASS"
    && differenceDocument.status === "PASS"
    && showcases.length === FORMAL_CASE_IDS.size
    && showcases.every((item) => FORMAL_CASE_IDS.has(item.input.caseId)
      && item.input.caseId === item.semantic.caseId
      && item.contract === "W5-C1/W5-R1"
      && item.profileBinding.profileRevision === 3
      && item.profileBinding.assetTreeSha256 === FORMAL_SEAL
      && item.semantic.path.nodes.length > 0)
    && differences.length === 3
    && differences.every((pair) => pair.differenceCount === pair.differences.length && pair.differenceCount >= 3);
  if (!valid) throw new Error("w5_a_d4_formal_showcase_binding_invalid");
  return { showcases, differences };
}

const formalInputs = parseFormalInputs();

export const FORMAL_SHOWCASES = formalInputs.showcases;
export const FORMAL_DIFFERENCES = formalInputs.differences;
export const FORMAL_SHOWCASE_SEAL = FORMAL_SEAL;
