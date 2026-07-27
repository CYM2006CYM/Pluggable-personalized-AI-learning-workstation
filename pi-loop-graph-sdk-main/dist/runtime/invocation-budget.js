export class InvocationBudgetExceededError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = "InvocationBudgetExceededError";
    }
}
export class InvocationBudget {
    limits;
    graphInvocations = 0;
    nodeVisits = 0;
    maxDepthReached = 0;
    constructor(limits) {
        this.limits = limits;
    }
    enterGraph(depth) {
        if (depth > this.limits.maxGraphDepth) {
            throw new InvocationBudgetExceededError("graph-depth", `Graph depth ${depth} exceeds maxGraphDepth ${this.limits.maxGraphDepth}`);
        }
        if (this.graphInvocations + 1 > this.limits.maxGraphInvocations) {
            throw new InvocationBudgetExceededError("graph-invocations", `Graph invocation count exceeds maxGraphInvocations ${this.limits.maxGraphInvocations}`);
        }
        this.graphInvocations += 1;
        this.maxDepthReached = Math.max(this.maxDepthReached, depth);
    }
    enterNode() {
        if (this.nodeVisits + 1 > this.limits.maxTotalNodeVisits) {
            throw new InvocationBudgetExceededError("node-visits", `Node visit count exceeds maxTotalNodeVisits ${this.limits.maxTotalNodeVisits}`);
        }
        this.nodeVisits += 1;
    }
    get usage() {
        return Object.freeze({
            graphInvocations: this.graphInvocations,
            nodeVisits: this.nodeVisits,
            maxDepthReached: this.maxDepthReached,
        });
    }
    /** Restore budget position from a saved checkpoint. New usage must be at least as high. */
    restore(usage) {
        if (usage.graphInvocations < 0 || usage.nodeVisits < 0 || usage.maxDepthReached < 0) {
            throw new Error("Invalid budget usage");
        }
        if (usage.maxDepthReached > this.limits.maxGraphDepth) {
            throw new InvocationBudgetExceededError("graph-depth", `Checkpoint depth ${usage.maxDepthReached} exceeds maxGraphDepth ${this.limits.maxGraphDepth}`);
        }
        this.graphInvocations = Math.max(this.graphInvocations, usage.graphInvocations);
        this.nodeVisits = Math.max(this.nodeVisits, usage.nodeVisits);
        this.maxDepthReached = Math.max(this.maxDepthReached, usage.maxDepthReached);
    }
}
