import { Type } from "typebox";
import { AgentExecutionFailure, GraphRuntime as CoreGraphRuntime } from "../runtime/graph-runtime.js";
import { RuntimeEventBus } from "../runtime/event-bus.js";
import { GraphCatalog } from "../host/graph-catalog.js";
import { preflightGraphCapabilities } from "../host/preflight.js";
import { ToolCatalog } from "../host/tool-catalog.js";
import { CONTEXT_SNAPSHOT_MESSAGE_TYPE, PiNodeContext } from "./pi-node-context.js";
import { COMPLETE_TOOL_NAME, createCompleteTool } from "./complete-tool.js";
import { defaultModelMessageFormatter, } from "./model-messages.js";
import { OUTPUT_CONTRACT_MESSAGE_TYPE } from "./output-contract.js";
import { FileRunStore } from "../replay/store.js";
import { Recorder, toRecordedJson } from "../replay/recorder.js";
// `pi` creates one ExtensionAPI facade per extension, so neither a module-local
// WeakSet nor a marker on `pi` can deduplicate physical SDK copies. Use the
// process-global registry shared by every ESM module copy instead. Isolated
// AgentSessions supply a registration scope because their tool registries are
// independent even though they run in the same JavaScript process.
const COMPLETE_TOOL_REGISTRY = Symbol.for("pi-loop-graph-sdk.complete-tool-registry");
export const defaultCompletionFeedbackFormatter = ({ decision }) => {
    if (decision.decision === "accepted") {
        if (decision.validation === "passed")
            return "节点结果已通过检查并接受。";
        return decision.completionStatus === "failed" ? "Agent 报告当前节点失败。" : "Agent 报告当前节点取消。";
    }
    if (decision.decision === "rejected")
        return `节点结果未被接受：${decision.reason}`;
    return `${decision.scope === "graph" ? "图" : "节点"}验收失败：${decision.reason}`;
};
export function createLoopGraphExtension(pi, options = {}) {
    const limits = resolveLimits(options.limits);
    const modelMessageFormatter = {
        incompleteNode: options.modelMessageFormatter?.incompleteNode ?? defaultModelMessageFormatter.incompleteNode,
        deadRun: options.modelMessageFormatter?.deadRun ?? defaultModelMessageFormatter.deadRun,
        graphFailure: options.modelMessageFormatter?.graphFailure ?? defaultModelMessageFormatter.graphFailure,
    };
    const completionFeedbackFormatter = options.completionFeedbackFormatter ?? defaultCompletionFeedbackFormatter;
    const catalog = new GraphCatalog();
    const piToolCatalog = options.toolCatalog ? new ToolCatalog() : undefined;
    let rootActive = false;
    let activeNodeContext = null;
    let activeRecorder = null;
    const recordPiEvent = (event, scope) => {
        if (activeRecorder && scope)
            activeRecorder.record(event, scope);
    };
    // A long-lived Pi process can contain an older physical SDK copy which used
    // this Symbol for a bare Set. Upgrade that value in place-compatible form so
    // extensions loaded from mixed SDK revisions do not fail during startup.
    const processState = globalThis;
    const existingRegistry = processState[COMPLETE_TOOL_REGISTRY];
    const completeToolRegistry = existingRegistry instanceof Set
        ? {
            global: existingRegistry,
            scoped: new WeakMap(),
        }
        : existingRegistry ?? {
            global: new Set(),
            scoped: new WeakMap(),
        };
    processState[COMPLETE_TOOL_REGISTRY] = completeToolRegistry;
    const registrationScope = options.protocolToolRegistrationScope;
    const registeredProtocolTools = registrationScope
        ? completeToolRegistry.scoped.get(registrationScope) ?? (() => {
            const tools = new Set();
            completeToolRegistry.scoped.set(registrationScope, tools);
            return tools;
        })()
        : completeToolRegistry.global;
    if (!registeredProtocolTools.has(COMPLETE_TOOL_NAME)) {
        pi.registerTool(createCompleteTool());
        registeredProtocolTools.add(COMPLETE_TOOL_NAME);
    }
    pi.on("tool_result", async (event) => {
        const replayScope = activeNodeContext?.getReplayScope();
        recordPiEvent({
            domain: "tool",
            type: "tool_result",
            data: toRecordedJson({ toolName: event.toolName, input: event.input, content: event.content, isError: event.isError }, "forensic"),
        }, replayScope ? { ...replayScope, toolCallId: event.toolCallId } : null);
        if (event.toolName !== COMPLETE_TOOL_NAME || !activeNodeContext)
            return;
        const params = event.input;
        if (!params || Object.keys(params).some((key) => key !== "result") || !isRecord(params.result)) {
            const decision = {
                decision: "rejected",
                reason: "完成提交只能包含对象类型 result",
            };
            recordPiEvent({ domain: "completion", type: "completion.rejected", data: { reason: decision.reason, validatorStage: "protocol" } }, activeNodeContext.getReplayScope());
            return {
                content: [{ type: "text", text: completionFeedbackFormatter({ nodeId: "?", decision }) }],
                details: decision,
                isError: true,
            };
        }
        const decision = await activeNodeContext.submitCompletion({
            result: params.result,
        });
        return {
            content: [{ type: "text", text: completionFeedbackFormatter({ nodeId: "?", decision }) }],
            details: decision,
            isError: decision.decision !== "accepted",
        };
    });
    pi.on("agent_end", async () => {
        await activeNodeContext?.onAgentEnd();
    });
    pi.on("turn_start", async (event) => {
        recordPiEvent({ domain: "model", type: "model_turn_started", data: { turn: event.turnIndex } }, activeNodeContext?.getReplayScope());
    });
    pi.on("turn_end", async (event) => {
        const message = event.message;
        recordPiEvent({
            domain: "model",
            type: "model_turn_finished",
            data: toRecordedJson({
                turn: event.turnIndex,
                provider: message.provider ?? "unknown",
                model: message.model ?? "unknown",
                usage: message.usage ?? {},
                durationMs: message.durationMs,
                retry: message.retry ?? 0,
                message,
                toolResults: event.toolResults,
            }, "forensic"),
        }, activeNodeContext?.getReplayScope());
    });
    pi.on("tool_execution_start", async (event) => {
        const scope = activeNodeContext?.getReplayScope();
        recordPiEvent({ domain: "tool", type: "tool_execution_started", data: toRecordedJson({ toolName: event.toolName, args: event.args }, "forensic") }, scope ? { ...scope, toolCallId: event.toolCallId } : null);
    });
    pi.on("tool_execution_end", async (event) => {
        const scope = activeNodeContext?.getReplayScope();
        recordPiEvent({ domain: "tool", type: "tool_execution_finished", data: toRecordedJson({ toolName: event.toolName, result: event.result, isError: event.isError }, "forensic") }, scope ? { ...scope, toolCallId: event.toolCallId } : null);
    });
    pi.on("session_compact", async (event) => {
        activeNodeContext?.markContextCompacted();
        recordPiEvent({ domain: "compaction", type: "compaction_finished", data: toRecordedJson(event, "forensic") }, activeNodeContext?.getReplayScope());
    });
    pi.on("context", async (event) => {
        if (event.messages.some((item) => item.role === "compactionSummary")) {
            activeNodeContext?.markContextCompacted();
        }
        const message = activeNodeContext?.getContextSnapshotMessage();
        const contract = activeNodeContext?.getActiveOutputContractMessage();
        const messages = event.messages.filter((item) => !(item.role === "custom" && (item.customType === CONTEXT_SNAPSHOT_MESSAGE_TYPE || item.customType === OUTPUT_CONTRACT_MESSAGE_TYPE)));
        if (message) {
            recordPiEvent({ domain: "context", type: "context_snapshot_projected", data: toRecordedJson(message, "forensic") }, activeNodeContext?.getReplayScope());
        }
        return { messages: [message, contract, ...messages].filter(Boolean) };
    });
    if (!options.runtimeOnly) {
        pi.on("session_start", async (_event, context) => {
            context.ui.notify("Loop Graph Extension 已加载", "info");
        });
    }
    function registerCoreGraph(graph) {
        syncPiBusinessTools(options.toolCatalog, piToolCatalog, pi);
        preflightGraphCapabilities(graph, { ...options, toolCatalog: piToolCatalog });
        catalog.register(graph);
    }
    async function executeGraph(graph, trigger, executionOptions = {}) {
        if (rootActive)
            throw new Error("同一 LoopGraphExtension instance 不支持并发 root executeGraph；请使用独立 Host");
        rootActive = true;
        const previousTools = saveActiveTools(pi);
        const previousContext = activeNodeContext;
        const previousRecorder = activeRecorder;
        const eventBus = new RuntimeEventBus();
        const recording = executionOptions.recording ?? options.recording ?? "replay";
        const recorder = recording === "off" ? null : new Recorder({
            mode: recording,
            store: options.runStore ?? new FileRunStore(),
            artifactThresholdBytes: options.artifactThresholdBytes,
            pricingResolver: options.pricingResolver,
        });
        recorder?.attach(eventBus);
        activeRecorder = recorder;
        const nodeContext = new PiNodeContext(pi, limits.agentRunTimeoutMs, modelMessageFormatter, limits.completionValidationTimeoutMs, options.outputContractMaxBytes, (event) => recordPiEvent({
            domain: event.type.startsWith("completion.") ? "completion" : "context",
            type: event.type,
            data: toRecordedJson(event, "forensic"),
        }, nodeContext.getReplayScope()));
        activeNodeContext = nodeContext;
        try {
            syncPiBusinessTools(options.toolCatalog, piToolCatalog, pi);
            const input = trigger.source === "tool" || trigger.params ? (trigger.params ?? {}) : { args: trigger.args ?? "" };
            const runtime = new CoreGraphRuntime({
                eventBus,
                catalog,
                checkpointStore: options.runStore,
                toolCatalog: piToolCatalog,
                skillCatalog: options.skillCatalog,
                unsafeToolResolver: options.unsafeToolResolver,
                baseline: options.baseline,
                maxStickyContextBytes: options.contextMaxBytes,
                mechanisms: options.mechanisms,
                createInvocationAgentHost: options.createInvocationAgentHost
                    ? (request) => options.createInvocationAgentHost(request, activeRecorder)
                    : undefined,
                delegateGraph: options.createInvocationAgentHost
                    ? (request) => request.execute()
                    : undefined,
                runAgent: (node, _input, context) => {
                    pi.setActiveTools(context.tools.map((tool) => tool.name));
                    return runPiAgent(node.prompt ?? node.subGoal, node.output, context, nodeContext);
                },
                runAgentFromCode: (request, _node, context) => {
                    pi.setActiveTools(context.tools.map((tool) => tool.name));
                    return runPiAgent(request.prompt, request.output, context, nodeContext);
                },
            });
            const result = await runtime.execute(graph, input, {
                signal: executionOptions.signal,
                limits: executionOptions.limits,
                maxSteps: executionOptions.maxSteps ?? limits.rootMaxSteps,
            });
            if (!recorder)
                return result;
            const finalized = await recorder.finalize(result);
            if ((executionOptions.recordingRequired ?? options.recordingRequired) && finalized.replay.status !== "complete") {
                return {
                    rootRunId: result.rootRunId,
                    graphId: result.graphId,
                    graphVersion: result.graphVersion,
                    steps: result.steps,
                    durationMs: result.durationMs,
                    status: "failed",
                    replay: finalized.replay,
                    failure: {
                        code: "persistence-failed",
                        phase: "host",
                        message: finalized.replay.issues?.join("; ") ?? "Replay recording failed",
                        retryable: true,
                    },
                };
            }
            return { ...result, replay: finalized.replay };
        }
        finally {
            nodeContext.reset();
            restoreActiveTools(pi, previousTools);
            activeNodeContext = previousContext;
            activeRecorder = previousRecorder;
            rootActive = false;
        }
    }
    return {
        registerGraph: registerCoreGraph,
        exposeGraph,
        executeGraph,
        createAgentHost,
    };
    function createAgentHost(recorder = null) {
        const nodeContext = new PiNodeContext(pi, limits.agentRunTimeoutMs, modelMessageFormatter, limits.completionValidationTimeoutMs, options.outputContractMaxBytes, (event) => recordPiEvent({
            domain: event.type.startsWith("completion.") ? "completion" : "context",
            type: event.type,
            data: toRecordedJson(event, "forensic"),
        }, nodeContext.getReplayScope()));
        let disposed = false;
        const run = async (prompt, output, execution) => {
            if (disposed)
                throw new Error("Invocation Agent Host 已释放");
            const previousContext = activeNodeContext;
            const previousRecorder = activeRecorder;
            activeNodeContext = nodeContext;
            activeRecorder = recorder;
            try {
                pi.setActiveTools(execution.tools.map((tool) => tool.name));
                return await runPiAgent(prompt, output, execution, nodeContext);
            }
            finally {
                activeNodeContext = previousContext;
                activeRecorder = previousRecorder;
            }
        };
        return {
            runAgent: (node, _input, execution) => run(node.prompt ?? node.subGoal, node.output, execution),
            runAgentFromCode: (request, _node, execution) => run(request.prompt, request.output, execution),
            dispose() {
                if (disposed)
                    return;
                disposed = true;
                nodeContext.reset();
            },
        };
    }
    function exposeGraph(ref, exposure) {
        const graph = catalog.resolve(ref);
        if (!graph)
            throw new Error(`Graph not registered: ${ref.id}@${ref.version}`);
        if (exposure.kind === "command") {
            pi.registerCommand(exposure.name, {
                description: exposure.description,
                async handler(args, context) {
                    const input = (exposure.parseInput?.(args) ?? { args });
                    if (exposure.execution === "current-session") {
                        await executeGraph(graph, { source: "command", params: input });
                    }
                    else {
                        await executeExposedGraph(graph, input, context);
                    }
                },
            });
            return;
        }
        pi.registerTool({
            name: exposure.name,
            label: exposure.name,
            description: exposure.description ?? exposure.name,
            parameters: exposure.parameters ?? Type.Record(Type.String(), Type.Unknown()),
            async execute(_toolCallId, params, _signal, _onUpdate, context) {
                const input = (exposure.parseInput?.(params) ?? params);
                const result = exposure.execution === "current-session"
                    ? await executeGraph(graph, { source: "tool", params: input })
                    : await executeExposedGraph(graph, input, context);
                const formatted = exposure.formatResult?.(result) ?? result;
                return { content: [{ type: "text", text: typeof formatted === "string" ? formatted : JSON.stringify(formatted) }], details: formatted };
            },
        });
    }
    async function executeExposedGraph(graph, input, context) {
        const [{ AuthStorage }, { createPiGraphHost }] = await Promise.all([
            import("@earendil-works/pi-coding-agent"),
            import("./isolated-graph-session.js"),
        ]);
        const authStorage = AuthStorage.create();
        const host = await createPiGraphHost({
            authStorage,
            modelRegistry: context.modelRegistry,
            cwd: context.cwd,
            model: context.model,
            graphs: catalog.values,
            toolCatalog: options.toolCatalog,
            skillCatalog: options.skillCatalog,
            unsafeToolResolver: options.unsafeToolResolver,
            baseline: options.baseline,
            limits: options.limits,
            outputContractMaxBytes: options.outputContractMaxBytes,
            recording: options.recording,
            recordingRequired: options.recordingRequired,
            runStore: options.runStore,
            artifactThresholdBytes: options.artifactThresholdBytes,
            pricingResolver: options.pricingResolver,
        });
        try {
            return await host.execute(graph, input, { signal: context.signal });
        }
        finally {
            await host.dispose();
        }
    }
    async function runPiAgent(prompt, outputSchema, execution, context) {
        const stageId = execution.nodeVisit.stageId;
        context.setCurrentNodeId(stageId);
        context.setContextSnapshot(execution.snapshot);
        context.setNodeCompletionValidator(async (result) => {
            const validation = await execution.validateNodeCompletion(result);
            return validation.valid ? { isValid: true } : { isValid: false, reason: validation.reason ?? "Node completion rejected" };
        });
        context.setRouteCompletionValidator(async (result) => {
            const validation = await execution.validateRouteStructure(result);
            return validation.valid ? { isValid: true } : { isValid: false, reason: validation.reason ?? "Route structure rejected" };
        });
        context.setMechanismLifecycle({
            beforeAgentRun: async () => ({ blocked: false }),
            validateCompletion: async (_agentRunId, completion) => {
                const decision = await execution.validateMechanismCompletion(completion.result);
                return decision.action === "allow"
                    ? { action: "allow" }
                    : { action: decision.action, reason: decision.reason };
            },
            afterAgentRun: () => undefined,
        });
        context.setPostMechanismCompletionValidator(async (result) => {
            const validation = await execution.validateAgentChoice(result);
            return validation.valid ? { isValid: true } : { isValid: false, reason: validation.reason ?? "Agent choice rejected" };
        });
        try {
            const completion = await context.runAgent({
                prompt,
                outputSchema: outputSchema,
            });
            if (completion.status !== "ok") {
                throw new AgentExecutionFailure(toAgentFailure(completion, stageId));
            }
            return completion.result;
        }
        finally {
            context.setContextSnapshot(null);
            context.setMechanismLifecycle(null);
        }
    }
}
function toAgentFailure(completion, stageId) {
    const result = completion.result;
    const reason = typeof result.reason === "string" ? result.reason : "Agent execution failed";
    const runtimeFailure = isRecord(result.runtimeFailure) ? result.runtimeFailure : undefined;
    const completionGate = isRecord(result.completionGate) ? result.completionGate : undefined;
    const gateAction = completionGate?.action;
    if (gateAction === "fail-node" || gateAction === "fail-graph") {
        return {
            code: "mechanism-failed",
            phase: gateAction === "fail-graph" ? "graph" : "node",
            message: reason,
            retryable: false,
            stageId,
        };
    }
    const code = typeof runtimeFailure?.code === "string"
        ? runtimeFailure.code
        : "runtime-error";
    const phase = typeof runtimeFailure?.phase === "string"
        ? runtimeFailure.phase
        : "agent";
    return {
        code,
        phase,
        message: reason,
        retryable: runtimeFailure?.retryable === true,
        stageId,
    };
}
function resolveLimits(limits) {
    const resolved = {
        rootMaxSteps: limits?.rootMaxSteps ?? 100,
        childMaxSteps: limits?.childMaxSteps ?? 50,
        agentRunTimeoutMs: limits?.agentRunTimeoutMs ?? 300_000,
        completionValidationTimeoutMs: limits?.completionValidationTimeoutMs ?? 60_000,
    };
    for (const [name, value] of Object.entries(resolved)) {
        if (!Number.isInteger(value) || value <= 0)
            throw new Error(`${name} 必须是正整数`);
    }
    return resolved;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function saveActiveTools(pi) {
    try {
        return pi.getActiveTools();
    }
    catch {
        return [];
    }
}
function restoreActiveTools(pi, tools) {
    pi.setActiveTools(tools);
}
function syncPiBusinessTools(catalog, available, pi) {
    if (!catalog || !available)
        return;
    const registered = new Set(pi.getAllTools().map((tool) => tool.name));
    for (const name of catalog.names) {
        const tool = catalog.resolve(name);
        if (!tool || available.has(name))
            continue;
        if (registered.has(name)) {
            available.register(tool);
            continue;
        }
        if (!tool.execute)
            continue;
        const definition = {
            name: tool.name,
            label: tool.label ?? tool.name,
            description: tool.description ?? tool.name,
            parameters: tool.parameters ?? Type.Record(Type.String(), Type.Unknown()),
            async execute(_toolCallId, params, signal, onUpdate, context) {
                const result = await tool.execute(params, signal, onUpdate, context);
                if (isAgentToolResult(result))
                    return result;
                const text = typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
                return {
                    content: [{ type: "text", text }],
                    details: result,
                };
            },
        };
        pi.registerTool(definition);
        registered.add(name);
        available.register(tool);
    }
}
function isAgentToolResult(value) {
    return isRecord(value) && Array.isArray(value.content);
}
