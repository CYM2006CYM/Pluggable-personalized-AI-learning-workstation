import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager, } from "@earendil-works/pi-coding-agent";
import { createLoopGraphExtension, } from "./loop-graph-extension.js";
import { IsolatedSessionGraphHost } from "./graph-execution-host.js";
import { createGraphHost } from "../host/graph-host.js";
import { GraphCatalog } from "../host/graph-catalog.js";
import { FileRunStore } from "../replay/store.js";
/**
 * 使用 pi 官方 in-memory AgentSession 创建隔离图执行环境。
 *
 * 子会话通过 inline extension factory 安装同一套 LoopGraph Runtime，避免维护
 * 第二套 graph loop。runtimeOnly 模式只保留运行钩子，不注册对外命令或资源通知。
 */
export function createIsolatedGraphSessionFactory(options) {
    const legacyOptions = options;
    return async (_request) => {
        const cwd = options.cwd ?? process.cwd();
        const agentDir = options.agentDir ?? getAgentDir();
        const settingsManager = SettingsManager.inMemory(options.compaction ? { compaction: options.compaction } : undefined);
        let loop = null;
        // A child AgentSession owns a fresh extension/tool registry. Keep a stable
        // scope for all inline-factory loads belonging to this one Session.
        const protocolToolRegistrationScope = {};
        const resourceLoader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            extensionFactories: [
                (pi) => {
                    loop = createLoopGraphExtension(pi, {
                        runtimeOnly: true,
                        protocolToolRegistrationScope,
                        defaultTools: legacyOptions.defaultTools,
                        toolCatalog: options.toolCatalog,
                        skillCatalog: options.skillCatalog,
                        unsafeToolResolver: options.unsafeToolResolver,
                        baseline: options.baseline,
                        skillBasePath: options.skillBasePath,
                        frameFormatter: options.frameFormatter,
                        createDelegateHost: options.createDelegateHost,
                        delegateTools: options.customTools,
                        delegateCompaction: options.compaction,
                        limits: options.limits,
                        contextRenderer: options.contextRenderer,
                        modelMessageFormatter: options.modelMessageFormatter,
                        completionFeedbackFormatter: options.completionFeedbackFormatter,
                        outputContractMaxBytes: options.outputContractMaxBytes,
                        skillProvider: options.skillProvider,
                        skillRenderer: options.skillRenderer,
                        skillFailure: options.skillFailure,
                        contextRenderers: options.contextRenderers,
                        toolResolver: options.toolResolver,
                        traceSink: options.traceSink,
                        logger: options.logger,
                        debug: options.debug,
                        debugLogPath: options.debugLogPath,
                        recording: options.recording,
                        recordingRequired: options.recordingRequired,
                        runStore: options.runStore,
                        artifactThresholdBytes: options.artifactThresholdBytes,
                        pricingResolver: options.pricingResolver,
                        createInvocationAgentHost: (_request, recorder) => createPiInvocationAgentHost(options, recorder),
                    });
                },
            ],
        });
        await resourceLoader.reload();
        const customToolNames = (options.customTools ?? []).map((tool) => tool.name);
        const catalogToolNames = options.toolCatalog?.names ?? [];
        const activeTools = [
            "read",
            ...(legacyOptions.defaultTools ?? []),
            ...customToolNames,
            ...catalogToolNames,
            "__graph_complete__",
        ];
        const { session } = await createAgentSession({
            cwd,
            agentDir,
            authStorage: options.authStorage,
            modelRegistry: options.modelRegistry,
            model: options.model,
            thinkingLevel: options.thinkingLevel ?? "off",
            sessionManager: SessionManager.inMemory(cwd),
            settingsManager,
            resourceLoader,
            customTools: options.customTools,
            tools: [...new Set(activeTools)],
        });
        if (!loop) {
            session.dispose();
            throw new Error("runtime-only LoopGraph extension 初始化失败");
        }
        const runtime = loop;
        // Resource loading may instantiate the inline extension more than once. Register
        // only after createAgentSession has selected the final instance that run() uses.
        for (const graph of options.graphs ?? [])
            runtime.registerGraph(graph);
        return {
            run(graph, request) {
                return runtime.executeGraph(graph, {
                    source: "tool",
                    params: request.background,
                }, {
                    signal: request.signal,
                    limits: request.limits,
                    maxSteps: request.maxSteps,
                    recording: request.recording,
                    recordingRequired: request.recordingRequired,
                });
            },
            abort() {
                return session.abort();
            },
            dispose() {
                session.dispose();
            },
        };
    };
}
/**
 * 构造可递归 delegate 的一次性 host factory。每次调用创建新 host/session，
 * 子 session 内的 delegate graph-node 继续复用同一份认证、模型与真实工具实现。
 */
export function createIsolatedDelegateHostFactory(options) {
    let createSession;
    const createHost = async () => new IsolatedSessionGraphHost({ createSession });
    createSession = createIsolatedGraphSessionFactory({
        ...options,
        createDelegateHost: createHost,
    });
    return createHost;
}
/** Creates one Pi Session that only executes Agent Runs for a Core Graph Invocation. */
export async function createPiInvocationAgentHost(options, recorder = null) {
    const cwd = options.cwd ?? process.cwd();
    const agentDir = options.agentDir ?? getAgentDir();
    const settingsManager = SettingsManager.inMemory(options.compaction ? { compaction: options.compaction } : undefined);
    let loop = null;
    // Invocation hosts are also isolated Sessions and therefore need their own
    // completion-tool registration scope.
    const protocolToolRegistrationScope = {};
    const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
            (pi) => {
                loop = createLoopGraphExtension(pi, {
                    runtimeOnly: true,
                    protocolToolRegistrationScope,
                    toolCatalog: options.toolCatalog,
                    skillCatalog: options.skillCatalog,
                    unsafeToolResolver: options.unsafeToolResolver,
                    baseline: options.baseline,
                    limits: options.limits,
                    modelMessageFormatter: options.modelMessageFormatter,
                    completionFeedbackFormatter: options.completionFeedbackFormatter,
                    outputContractMaxBytes: options.outputContractMaxBytes,
                    recording: "off",
                    createInvocationAgentHost: (_request, nestedRecorder) => createPiInvocationAgentHost(options, nestedRecorder),
                });
            },
        ],
    });
    await resourceLoader.reload();
    const customToolNames = (options.customTools ?? []).map((tool) => tool.name);
    const catalogToolNames = options.toolCatalog?.names ?? [];
    const { session } = await createAgentSession({
        cwd,
        agentDir,
        authStorage: options.authStorage,
        modelRegistry: options.modelRegistry,
        model: options.model,
        thinkingLevel: options.thinkingLevel ?? "off",
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager,
        resourceLoader,
        customTools: options.customTools,
        tools: [...new Set(["read", ...customToolNames, ...catalogToolNames, "__graph_complete__"])],
    });
    if (!loop) {
        session.dispose();
        throw new Error("invocation-scoped Pi Agent Host 初始化失败");
    }
    const runtime = loop;
    for (const graph of options.graphs ?? [])
        runtime.registerGraph(graph);
    const agentHost = runtime.createAgentHost(recorder);
    let disposed = false;
    return {
        runAgent: agentHost.runAgent,
        runAgentFromCode: agentHost.runAgentFromCode,
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            try {
                await session.abort();
            }
            finally {
                await agentHost.dispose();
                session.dispose();
            }
        },
    };
}
/** Creates a Core GraphHost backed by one isolated Pi AgentSession. */
export async function createPiGraphHost(options) {
    const effectiveOptions = { ...options, runStore: options.runStore ?? new FileRunStore() };
    const createSession = createIsolatedGraphSessionFactory(effectiveOptions);
    const session = await createSession({
        background: {},
        invocationKind: "api",
        boundary: "call",
    });
    let disposed = false;
    let running = false;
    return {
        async execute(graph, input, runOptions = {}) {
            if (disposed)
                throw new Error("GraphHost 已释放");
            if (running)
                throw new Error("GraphHost 已有 Root Run 正在执行；并发运行必须创建独立 Host");
            if (runOptions.signal?.aborted)
                throw abortError();
            running = true;
            const onAbort = () => { void session.abort().catch(() => undefined); };
            runOptions.signal?.addEventListener("abort", onAbort, { once: true });
            try {
                return await session.run(graph, {
                    background: input,
                    invocationKind: "api",
                    boundary: "call",
                    signal: runOptions.signal,
                    limits: runOptions.limits,
                    maxSteps: runOptions.maxSteps,
                    recording: runOptions.recording,
                    recordingRequired: runOptions.recordingRequired,
                });
            }
            finally {
                runOptions.signal?.removeEventListener("abort", onAbort);
                running = false;
            }
        },
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            try {
                await session.abort();
            }
            finally {
                session.dispose();
            }
        },
        async resume(graph, resumeOptions) {
            if (disposed)
                throw new Error("GraphHost 已释放");
            if (running)
                throw new Error("GraphHost 已有 Root Run 正在执行；并发运行必须创建独立 Host");
            running = true;
            const catalog = new GraphCatalog();
            for (const registered of effectiveOptions.graphs ?? [])
                catalog.register(registered);
            if (!catalog.has({ id: graph.id, version: graph.version }))
                catalog.register(graph);
            const agentHost = await createPiInvocationAgentHost(effectiveOptions, null);
            const resumeHost = createGraphHost({
                runtime: {
                    catalog,
                    toolCatalog: effectiveOptions.toolCatalog,
                    skillCatalog: effectiveOptions.skillCatalog,
                    unsafeToolResolver: effectiveOptions.unsafeToolResolver,
                    baseline: effectiveOptions.baseline,
                    runAgent: agentHost.runAgent,
                    runAgentFromCode: agentHost.runAgentFromCode,
                    createInvocationAgentHost: (request) => createPiInvocationAgentHost(effectiveOptions, null),
                    delegateGraph: (request) => request.execute(),
                },
                runStore: effectiveOptions.runStore,
                checkpointStore: effectiveOptions.runStore,
                recording: effectiveOptions.recording,
                recordingRequired: effectiveOptions.recordingRequired,
                artifactThresholdBytes: effectiveOptions.artifactThresholdBytes,
                pricingResolver: effectiveOptions.pricingResolver,
            });
            try {
                return await resumeHost.resume(graph, resumeOptions);
            }
            finally {
                running = false;
                await resumeHost.dispose();
                await agentHost.dispose();
            }
        },
    };
}
function abortError() {
    const error = new Error("Graph execution aborted");
    error.name = "AbortError";
    return error;
}
