/** 为旧调用（仅有 invocationKind，无 boundary）填补默认值。
 *  旧 `"subgraph"` → `graph-node` + `call`。 */
export function normalizeGraphRunRequest(partial) {
    let kind;
    if (partial.invocationKind === "subgraph") {
        kind = "graph-node";
    }
    else if (partial.invocationKind === "command" ||
        partial.invocationKind === "tool" ||
        partial.invocationKind === "graph-node" ||
        partial.invocationKind === "api") {
        kind = partial.invocationKind;
    }
    else {
        throw new Error(`未知 GraphInvocationKind: ${partial.invocationKind}`);
    }
    const boundary = partial.boundary ?? (kind === "tool" || kind === "command" ? "delegate" : "call");
    return { background: partial.background, invocationKind: kind, boundary, signal: partial.signal };
}
/** 每次 invoke 创建一次性 host，并固定执行 run → abort/dispose 生命周期。 */
export class DelegateGraphInvoker {
    pi;
    createHost;
    constructor(pi, createHost) {
        this.pi = pi;
        this.createHost = createHost;
    }
    async invoke(graph, request, extensionContext) {
        if (request.boundary !== "delegate") {
            throw new Error(`DelegateGraphInvoker 只接受 delegate boundary，收到: ${request.boundary}`);
        }
        const host = await this.createHost({
            pi: this.pi,
            extensionContext,
            graph,
            request,
        });
        let runError;
        try {
            return await host.run(graph, request);
        }
        catch (error) {
            runError = error;
            throw error;
        }
        finally {
            try {
                await host.dispose();
            }
            catch (disposeError) {
                if (runError != null) {
                    runError.suppressed = disposeError;
                }
                else {
                    throw disposeError;
                }
            }
        }
    }
}
/**
 * 为一次 graph-tool 调用持有一个独立子 AgentSession 的生命周期外壳。
 *
 * 契约：
 * - 一个 host 同时只运行一张图；并发调用应创建多个 host。
 * - outer AbortSignal 会转发给子会话 abort()。
 * - dispose 顺序固定为 abort() -> dispose()。
 * - dispose 后拒绝 run()，弥补 AgentSession.dispose() 仍允许 prompt 的行为。
 */
export class IsolatedSessionGraphHost {
    options;
    session = null;
    sessionPromise = null;
    cleanedSession = null;
    disposed = false;
    running = false;
    disposing = null;
    constructor(options) {
        this.options = options;
    }
    async run(graph, request) {
        this.assertUsable();
        if (this.running) {
            throw new Error("IsolatedSessionGraphHost 已有图正在运行；并发调用必须创建独立 host");
        }
        if (request.signal?.aborted)
            throw createAbortError();
        this.running = true;
        try {
            const sessionPromise = this.options.createSession(request);
            this.sessionPromise = sessionPromise;
            let session;
            try {
                session = await sessionPromise;
            }
            finally {
                if (this.sessionPromise === sessionPromise)
                    this.sessionPromise = null;
            }
            // createSession 期间也可能收到 dispose/abort。
            if (this.disposed || request.signal?.aborted) {
                await this.cleanupSession(session);
                if (request.signal?.aborted)
                    throw createAbortError();
                throw new Error("IsolatedSessionGraphHost 已释放");
            }
            this.session = session;
            const onAbort = () => {
                void session.abort().catch(() => undefined);
            };
            request.signal?.addEventListener("abort", onAbort, { once: true });
            try {
                return await session.run(graph, request);
            }
            finally {
                request.signal?.removeEventListener("abort", onAbort);
            }
        }
        finally {
            this.running = false;
        }
    }
    async dispose() {
        if (this.disposing)
            return this.disposing;
        this.disposed = true;
        this.disposing = (async () => {
            const pendingSession = this.sessionPromise;
            const session = this.session;
            this.session = null;
            if (session) {
                await this.cleanupSession(session);
                return;
            }
            if (pendingSession) {
                try {
                    await this.cleanupSession(await pendingSession);
                }
                catch {
                    // createSession 自身失败时没有可清理的 session。
                }
            }
        })();
        return this.disposing;
    }
    assertUsable() {
        if (this.disposed)
            throw new Error("IsolatedSessionGraphHost 已释放");
    }
    async cleanupSession(session) {
        if (this.cleanedSession === session)
            return;
        this.cleanedSession = session;
        await abortThenDispose(session);
    }
}
async function abortThenDispose(session) {
    let abortError = undefined;
    try {
        await session.abort();
    }
    catch (e) {
        abortError = e;
    }
    try {
        session.dispose();
    }
    catch (disposeError) {
        if (abortError != null) {
            abortError.suppressed = disposeError;
        }
        throw abortError ?? disposeError;
    }
    if (abortError != null)
        throw abortError;
}
function createAbortError() {
    const error = new Error("Graph execution aborted");
    error.name = "AbortError";
    return error;
}
