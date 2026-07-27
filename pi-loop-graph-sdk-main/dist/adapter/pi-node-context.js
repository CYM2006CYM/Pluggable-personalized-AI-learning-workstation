// ============================================================
//  PiNodeContext — Promise 桥接
// ============================================================
//
//  不注入 entry message（投影钩子负责），只做两件事：
//    1. 发送 prompt + triggerTurn
//    2. 等待 agent_end 返回 NodeCompletion
//
//  如何获取 NodeCompletion：
//    - agent 调用 __graph_complete__ 工具
//    - extension.ts 的 tool_result 钩子捕获参数 → submitCompletion()
//    - extension.ts 的 agent_end 钩子 → onAgentEnd() → resolve Promise
// ============================================================
import { debugLog } from "./debug-log.js";
import { defaultModelMessageFormatter, } from "./model-messages.js";
import { OUTPUT_CONTRACT_MESSAGE_TYPE, prepareOutputContract, } from "./output-contract.js";
const DEFAULT_MAX_COMPLETION_REJECTIONS = 3;
export const CONTEXT_SNAPSHOT_MESSAGE_TYPE = "loop_graph_context";
export class PiNodeContext {
    outputContractMaxBytes;
    telemetry;
    signal;
    pi;
    currentNodeId = null;
    /** __graph_complete__ 捕获的 completion 列表（同节点内可能调多次） */
    pendingCompletions = [];
    completionFingerprints = new Set();
    /** 活跃 run 的 resolve */
    activeResolve = null;
    activeRunId = 0;
    nextRunId = 1;
    agentRunTimeoutMs;
    messageFormatter;
    completionValidationTimeoutMs;
    nodeValidateFn = undefined;
    routeValidateFn = undefined;
    postMechanismValidateFn = undefined;
    mechanismLifecycle = null;
    validationInFlight = null;
    activeOutputContract = null;
    activeOutputContractMessage = null;
    activeContextSnapshot = null;
    contextProjectionCount = 0;
    foldableContextCompacted = false;
    submissionQueue = Promise.resolve();
    rejectionCount = 0;
    completionState = "submitted";
    get completionSubmissionState() {
        return this.completionState;
    }
    constructor(pi, agentRunTimeoutMs = 5 * 60 * 1000, messageFormatter = defaultModelMessageFormatter, completionValidationTimeoutMs = 60_000, outputContractMaxBytes = 64 * 1024, telemetry) {
        this.outputContractMaxBytes = outputContractMaxBytes;
        this.telemetry = telemetry;
        this.pi = pi;
        this.agentRunTimeoutMs = agentRunTimeoutMs;
        this.messageFormatter = messageFormatter;
        this.completionValidationTimeoutMs = completionValidationTimeoutMs;
        this.signal = new AbortController().signal;
        // ── Provider 错误回流通道（单一监听器，生命周期跟实例走）──
        // pi 没有 off，监听器只增不减。挪到构造函数注册一次，
        // 回调读实例当前的 activeRunId/activeResolve，避免闭包泄漏。
        // 排除 429（限流，pi 内部可能重试成功）。
        pi.on("after_provider_response", (event, _ctx) => {
            if (event.status >= 400 &&
                event.status !== 429 &&
                this.activeRunId !== 0 &&
                this.activeResolve) {
                this.activeResolve({
                    nodeId: this.currentNodeId ?? "unknown",
                    status: "failed",
                    result: { reason: `Provider error: HTTP ${event.status}` },
                });
            }
        });
    }
    // ── NodeContext 接口 ──────────────────────────────────
    runValidateFn = undefined;
    async runAgent(request) {
        // schema 配置错误必须在占用 active run 之前抛出，避免把 NodeContext
        // 永久留在一个没有 Promise/timeout 可以收尾的运行状态。
        const outputContract = prepareOutputContract(request.outputSchema, this.outputContractMaxBytes);
        this.pendingCompletions = [];
        this.completionFingerprints.clear();
        const runId = this.nextRunId++;
        this.activeRunId = runId;
        this.runValidateFn = request.validateCompletion;
        this.activeOutputContract = outputContract;
        this.activeOutputContractMessage = outputContract
            ? Object.freeze({
                customType: OUTPUT_CONTRACT_MESSAGE_TYPE,
                content: outputContract.modelText,
                display: false,
                details: Object.freeze({
                    protocol: 1,
                    agentRunId: runId,
                    schemaFingerprint: outputContract.fingerprint,
                }),
            })
            : null;
        if (outputContract) {
            this.emitTelemetry({
                type: "output_contract.prepared",
                agentRunId: runId,
                schemaFingerprint: outputContract.fingerprint,
                schemaBytes: outputContract.byteSize,
            });
        }
        try {
            const start = this.mechanismLifecycle
                ? await this.mechanismLifecycle.beforeAgentRun(runId, request)
                : undefined;
            if (start?.blocked) {
                this.activeRunId = 0;
                this.clearAgentRunArtifacts(runId);
                this.mechanismLifecycle?.afterAgentRun(runId);
                return {
                    nodeId: this.currentNodeId ?? "unknown",
                    status: "failed",
                    result: { reason: start.reason ?? "mechanism 阻止了 agent run" },
                };
            }
        }
        catch (error) {
            this.activeRunId = 0;
            this.clearAgentRunArtifacts(runId);
            this.mechanismLifecycle?.afterAgentRun(runId);
            throw error;
        }
        const promise = new Promise((res) => {
            const timeout = setTimeout(() => {
                if (this.activeRunId !== runId)
                    return;
                this.activeRunId = 0;
                this.activeResolve = null;
                this.clearAgentRunArtifacts(runId);
                res({
                    nodeId: this.currentNodeId ?? "unknown",
                    status: "failed",
                    result: {
                        reason: this.agentRunTimeoutMs === 5 * 60 * 1000
                            ? "Agent run timed out after 5 minutes"
                            : `Agent run timed out after ${this.agentRunTimeoutMs} ms`,
                        runtimeFailure: {
                            code: "agent-timeout",
                            phase: "agent",
                            retryable: true,
                        },
                    },
                });
            }, this.agentRunTimeoutMs);
            this.activeResolve = (c) => {
                clearTimeout(timeout);
                this.activeRunId = 0;
                this.activeResolve = null;
                this.clearAgentRunArtifacts(runId);
                res(c);
            };
        });
        if (this.activeOutputContractMessage) {
            this.pi.sendMessage(this.activeOutputContractMessage, {});
        }
        // 发送 prompt，触发 agent 运行
        this.pi.sendMessage({
            customType: "loop_graph_prompt",
            content: request.prompt,
            display: false,
        }, { triggerTurn: true });
        try {
            return await promise;
        }
        catch (error) {
            return {
                nodeId: this.currentNodeId ?? "unknown",
                status: "failed",
                result: {
                    reason: error instanceof Error ? error.message : String(error),
                },
            };
        }
        finally {
            this.mechanismLifecycle?.afterAgentRun(runId);
        }
    }
    /**
     * 直接执行 pi 平台上的工具。当前占用位，未实现。
     *
     * 纯代码节点不需要此方法——你可以在 execute 里直接
     * import 并使用任何 Node.js 或第三方库：
     *
     * ```typescript
     * execute: async (instance, input, ctx) => {
     *   const data = fs.readFileSync(input.data.path, "utf-8");
     *   const result = await fetch("https://api.example.com", {...});
     *   return { nodeId: "parse", status: "ok", result: { data, result } };
     * }//讨论在有纯代码节点的前提下该功能是否必要
     * ```
     */
    async callTool(_name, _input) {
        throw new Error("PiNodeContext.callTool 未实现。纯代码节点请直接在 execute 中使用 Node.js API。");
    }
    // ── 供 extension.ts 调用 ──────────────────────────────
    /** 当前节点内调用 __graph_complete__ 的次数 */
    get completeCount() {
        return this.pendingCompletions.length;
    }
    getActiveOutputContractMessage() {
        return this.activeOutputContractMessage;
    }
    setContextSnapshot(snapshot) {
        if (snapshot?.agentRunId !== this.activeContextSnapshot?.agentRunId) {
            this.contextProjectionCount = 0;
            this.foldableContextCompacted = false;
        }
        this.activeContextSnapshot = snapshot;
    }
    markContextCompacted() {
        this.foldableContextCompacted = true;
    }
    getContextSnapshotMessage() {
        const snapshot = this.activeContextSnapshot;
        if (!snapshot)
            return null;
        const content = [];
        for (const layer of snapshot.layers) {
            if (layer.retention === "foldable" && this.foldableContextCompacted)
                continue;
            if (layer.retention === "transient" && this.contextProjectionCount > 0)
                continue;
            if (typeof layer.content === "string")
                content.push({ type: "text", text: layer.content });
            else
                content.push(...layer.content.map((block) => ({ ...block })));
        }
        this.contextProjectionCount += 1;
        return Object.freeze({
            role: "custom",
            customType: CONTEXT_SNAPSHOT_MESSAGE_TYPE,
            content,
            display: false,
            details: Object.freeze({
                rootRunId: snapshot.rootRunId,
                graphInvocationId: snapshot.graphInvocationId,
                nodeVisitId: snapshot.nodeVisitId,
                agentRunId: snapshot.agentRunId,
                memoryRevision: snapshot.memoryRevision,
            }),
            timestamp: Date.now(),
        });
    }
    getReplayScope() {
        const snapshot = this.activeContextSnapshot;
        if (!snapshot)
            return null;
        return {
            rootRunId: snapshot.rootRunId,
            graphInvocationId: snapshot.graphInvocationId,
            nodeVisitId: snapshot.nodeVisitId,
            agentRunId: snapshot.agentRunId,
        };
    }
    submitCompletion(params) {
        const runId = this.activeRunId;
        const schemaFingerprint = this.activeOutputContract?.fingerprint;
        const startedAt = Date.now();
        const submission = {
            result: params.result,
        };
        this.completionState = "submitted";
        this.emitTelemetry({
            type: "completion.submitted",
            agentRunId: runId,
            schemaFingerprint,
        });
        const result = this.submissionQueue.then(() => this.processCompletionSubmission(submission, runId)).then((decision) => {
            const durationMs = Date.now() - startedAt;
            if (decision.decision === "accepted") {
                this.completionState = "accepted";
                this.emitTelemetry({
                    type: "completion.accepted",
                    agentRunId: runId,
                    completionStatus: decision.completionStatus,
                    schemaFingerprint,
                    durationMs,
                });
            }
            else if (decision.decision === "rejected") {
                this.completionState = "rejected";
                this.emitTelemetry({
                    type: "completion.rejected",
                    agentRunId: runId,
                    reason: decision.reason,
                    validatorStage: decision.validatorStage,
                    schemaFingerprint,
                    durationMs,
                });
            }
            else {
                this.completionState = "failed";
                this.emitTelemetry({
                    type: "completion.failed",
                    agentRunId: runId,
                    scope: decision.scope,
                    reason: decision.reason,
                    validatorStage: decision.validatorStage,
                    schemaFingerprint,
                    durationMs,
                });
            }
            return decision;
        });
        this.submissionQueue = result.then(() => undefined, () => undefined);
        return result;
    }
    onAgentEnd() {
        if (this.validationInFlight)
            return this.validationInFlight;
        const work = this.submissionQueue.then(() => this.processAgentEnd());
        this.validationInFlight = work;
        return work.finally(() => {
            if (this.validationInFlight === work) {
                this.validationInFlight = null;
            }
        });
    }
    async processAgentEnd() {
        if (this.activeRunId === 0) {
            // 图已终止，agent 仍在跑 → 追加消息告知
            this.pi.sendMessage({
                customType: "loop_graph_dead",
                content: this.messageFormatter.deadRun({ nodeId: this.currentNodeId }),
                display: false,
            }, {});
            return;
        }
        const resolve = this.activeResolve;
        if (!resolve)
            return;
        if (this.pendingCompletions.length > 0) {
            const currentCompletions = this.pendingCompletions;
            this.pendingCompletions = [];
            this.completionFingerprints.clear();
            // 取最后一次调用作为主 completion
            const last = currentCompletions[currentCompletions.length - 1];
            // 如果调了多次，把全部记录附在 result 里
            const completion = {
                ...last,
                result: {
                    ...last.result,
                    ...(currentCompletions.length > 1
                        ? { allCompletions: currentCompletions }
                        : {}),
                },
            };
            resolve(completion);
        }
        else {
            resolve({
                nodeId: this.currentNodeId ?? "unknown",
                status: "failed",
                result: {
                    reason: this.messageFormatter.incompleteNode({
                        nodeId: this.currentNodeId ?? "unknown",
                        completeToolName: "__graph_complete__",
                    }),
                    runtimeFailure: {
                        code: "agent-ended-without-completion",
                        phase: "agent",
                        retryable: true,
                    },
                },
            });
        }
        this.activeResolve = null;
        this.activeRunId = 0;
        this.clearAgentRunArtifacts();
    }
    async processCompletionSubmission(submission, runId) {
        this.completionState = "validating";
        const schemaFingerprint = this.activeOutputContract?.fingerprint;
        if (runId === 0 || runId !== this.activeRunId) {
            return { decision: "rejected", reason: "当前 Agent Run 已结束", schemaFingerprint };
        }
        const fingerprint = createCompletionFingerprint({
            result: submission.result,
        });
        if (this.completionFingerprints.has(fingerprint)) {
            return { decision: "rejected", reason: "重复提交相同节点结果", schemaFingerprint };
        }
        const completion = {
            nodeId: this.currentNodeId ?? "unknown",
            status: "ok",
            result: { ...submission.result },
        };
        const validationStages = [
            ["outputSchema", this.activeOutputContract?.validate],
            ["agent-run", this.runValidateFn],
            ["node", this.nodeValidateFn],
            ["route", this.routeValidateFn],
        ];
        for (const [stage, validator] of validationStages) {
            if (!validator)
                continue;
            const validation = await this.runValidationStage(stage, validator, completion.result, runId, schemaFingerprint);
            if (!validation.isValid) {
                const exhausted = this.rejectOrExhaust(runId, stage, schemaFingerprint);
                if (exhausted)
                    return exhausted;
                debugLog.agentRetry(this.currentNodeId ?? "?", validation.reason);
                return {
                    decision: "rejected",
                    reason: validation.reason,
                    validatorStage: stage,
                    schemaFingerprint,
                };
            }
        }
        if (this.mechanismLifecycle) {
            this.emitValidationStarted(runId, "mechanism", schemaFingerprint);
            const gate = await this.mechanismLifecycle.validateCompletion(runId, completion);
            if (gate.action === "reject") {
                const exhausted = this.rejectOrExhaust(runId, "mechanism", schemaFingerprint);
                if (exhausted)
                    return exhausted;
                debugLog.agentRetry(this.currentNodeId ?? "?", gate.reason);
                return {
                    decision: "rejected",
                    reason: gate.reason,
                    validatorStage: "mechanism",
                    schemaFingerprint,
                };
            }
            if (gate.action === "fail-node" || gate.action === "fail-graph") {
                this.completionFingerprints.add(fingerprint);
                this.pendingCompletions.push({
                    nodeId: completion.nodeId,
                    status: "failed",
                    result: { reason: gate.reason, completionGate: { action: gate.action } },
                });
                return {
                    decision: "failed",
                    scope: gate.action === "fail-graph" ? "graph" : "node",
                    reason: gate.reason,
                    validatorStage: "mechanism",
                    schemaFingerprint,
                };
            }
            if (gate.action === "allow" && gate.verifiedResult) {
                completion.verifiedResult = gate.verifiedResult;
            }
        }
        if (this.postMechanismValidateFn) {
            const validation = await this.runValidationStage("agent-choice", this.postMechanismValidateFn, completion.result, runId, schemaFingerprint);
            if (!validation.isValid) {
                const exhausted = this.rejectOrExhaust(runId, "agent-choice", schemaFingerprint);
                if (exhausted)
                    return exhausted;
                debugLog.agentRetry(this.currentNodeId ?? "?", validation.reason);
                return {
                    decision: "rejected",
                    reason: validation.reason,
                    validatorStage: "agent-choice",
                    schemaFingerprint,
                };
            }
        }
        this.completionFingerprints.add(fingerprint);
        this.pendingCompletions.push(completion);
        return {
            decision: "accepted",
            completionStatus: "ok",
            validation: "passed",
            schemaFingerprint,
        };
    }
    rejectOrExhaust(runId, validatorStage, schemaFingerprint) {
        this.rejectionCount += 1;
        if (this.rejectionCount <= DEFAULT_MAX_COMPLETION_REJECTIONS)
            return undefined;
        const reason = `Agent Run 完成提交已达到最多 ${DEFAULT_MAX_COMPLETION_REJECTIONS} 次拒绝`;
        this.completionState = "failed";
        // Exhaustion is a Runtime terminal decision. Persist it so agent_end resolves
        // the same failure instead of incorrectly reporting "without completion".
        if (runId === this.activeRunId) {
            this.pendingCompletions.push({
                nodeId: this.currentNodeId ?? "unknown",
                status: "failed",
                result: {
                    reason,
                    completionGate: { action: "rejection-budget-exhausted" },
                    runtimeFailure: {
                        code: "validation-exhausted",
                        phase: "agent",
                        retryable: false,
                    },
                },
            });
        }
        return {
            decision: "failed",
            scope: "node",
            reason,
            validatorStage,
            schemaFingerprint,
        };
    }
    setCurrentNodeId(nodeId) {
        this.currentNodeId = nodeId;
        // 一个 NodeContext 在统一 Runtime 的 callStack 中复用。每次进入节点都
        // 必须切断前一节点（或前一子图）的 completion，节点内多次 runAgent 则不会
        // 再次调用本方法，仍可保留其 allCompletions 语义。
        this.pendingCompletions = [];
        this.completionFingerprints.clear();
        this.runValidateFn = undefined;
        this.nodeValidateFn = undefined;
        this.routeValidateFn = undefined;
        this.postMechanismValidateFn = undefined;
        this.activeOutputContract = null;
        this.activeOutputContractMessage = null;
        this.activeContextSnapshot = null;
        this.contextProjectionCount = 0;
        this.foldableContextCompacted = false;
        this.rejectionCount = 0;
        this.completionState = "submitted";
    }
    setNodeCompletionValidator(validate) {
        this.nodeValidateFn = validate;
    }
    setRouteCompletionValidator(validate) {
        this.routeValidateFn = validate;
    }
    setPostMechanismCompletionValidator(validate) {
        this.postMechanismValidateFn = validate;
    }
    setMechanismLifecycle(lifecycle) {
        this.mechanismLifecycle = lifecycle;
    }
    async runValidationStage(stage, validator, result, runId, schemaFingerprint) {
        this.emitValidationStarted(runId, stage, schemaFingerprint);
        return runCompletionValidator(validator, result, this.completionValidationTimeoutMs);
    }
    emitValidationStarted(agentRunId, validatorStage, schemaFingerprint) {
        this.emitTelemetry({
            type: "completion.validation_started",
            agentRunId,
            validatorStage,
            schemaFingerprint,
        });
    }
    emitTelemetry(event) {
        try {
            this.telemetry?.(Object.freeze(event));
        }
        catch {
            // telemetry 不能改变 Agent Run 控制流
        }
    }
    clearAgentRunArtifacts(expectedRunId) {
        const messageRunId = this.activeOutputContractMessage?.details?.agentRunId;
        if (expectedRunId !== undefined && messageRunId !== undefined && messageRunId !== expectedRunId) {
            return;
        }
        this.runValidateFn = undefined;
        this.activeOutputContract = null;
        this.activeOutputContractMessage = null;
    }
    reset() {
        this.currentNodeId = null;
        this.pendingCompletions = [];
        this.completionFingerprints.clear();
        this.activeRunId = 0;
        this.activeResolve = null;
        this.runValidateFn = undefined;
        this.nodeValidateFn = undefined;
        this.routeValidateFn = undefined;
        this.postMechanismValidateFn = undefined;
        this.mechanismLifecycle = null;
        this.validationInFlight = null;
        this.activeOutputContract = null;
        this.activeOutputContractMessage = null;
        this.rejectionCount = 0;
        this.completionState = "submitted";
        this.activeContextSnapshot = null;
        this.submissionQueue = Promise.resolve();
        this.rejectionCount = 0;
        this.completionState = "submitted";
    }
}
async function runCompletionValidator(validator, result, timeoutMs) {
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve(validator(result)),
            new Promise((resolve) => {
                timeout = setTimeout(() => resolve({
                    isValid: false,
                    reason: `completion validation timed out after ${timeoutMs} ms`,
                }), timeoutMs);
            }),
        ]);
    }
    catch (error) {
        return {
            isValid: false,
            reason: `completion validator 异常: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function createCompletionFingerprint(params) {
    try {
        return JSON.stringify(params.result);
    }
    catch {
        return String(params.result);
    }
}
