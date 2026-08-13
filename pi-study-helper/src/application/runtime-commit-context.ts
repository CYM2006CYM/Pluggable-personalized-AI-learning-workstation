export interface RuntimeCommitSnapshot {
  latestCommit: { evidenceVersion: number };
  evidence: Array<{ evidenceId: string; knowledgePointId: string }>;
  activityProgress: Array<{
    nodeId: string;
    activities: Array<{ activityId: string; status: string }>;
  }>;
  path?: { nodes: Array<{ nodeId: string; knowledgePointId: string }> };
}

/** Internal commit facts. Public facades must return only output. */
export interface RuntimeCommitContext<T> {
  output: T;
  replayed: boolean;
  snapshot?: RuntimeCommitSnapshot;
}
