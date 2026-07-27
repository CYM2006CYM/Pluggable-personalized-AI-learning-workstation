import * as path from "node:path";
import Schema from "typebox/schema";
/**
 * mechanism state 的唯一所有者：每个 AgentInstance、每个 mechanism 对象一份。
 * WeakMap 不延长 instance 或 mechanism definition 的生命周期。
 */
export class MechanismStateStore {
    states = new WeakMap();
    resolve(instance, mechanism) {
        let instanceStates = this.states.get(instance);
        if (!instanceStates) {
            instanceStates = new WeakMap();
            this.states.set(instance, instanceStates);
        }
        const existing = instanceStates.get(mechanism);
        if (existing)
            return existing;
        let record;
        try {
            record = {
                state: mechanism.createState ? mechanism.createState() : {},
                initializationFailed: false,
            };
        }
        catch (initializationError) {
            record = { state: {}, initializationFailed: true, initializationError };
        }
        instanceStates.set(mechanism, record);
        return record;
    }
}
/** 一个 mechanism 在单次 node visit 内拥有的托管生命周期。 */
class MechanismInvocation {
    mechanismName;
    active = true;
    controller = new AbortController();
    cleanups = [];
    scope;
    constructor(mechanismName, descriptor, runtimeScopeIsCurrent) {
        this.mechanismName = mechanismName;
        this.scope = Object.freeze({
            scopeId: descriptor.scopeId,
            visit: descriptor.visit,
            signal: this.controller.signal,
            isActive: () => this.active && runtimeScopeIsCurrent(),
            onCleanup: (cleanup) => {
                if (!this.active) {
                    throw new Error(`mechanism ${this.mechanismName} 的 scope 已失效，不能再注册 cleanup`);
                }
                this.cleanups.push(cleanup);
            },
        });
    }
    async close() {
        if (!this.active)
            return [];
        this.active = false;
        this.controller.abort();
        const errors = [];
        for (let index = this.cleanups.length - 1; index >= 0; index--) {
            try {
                await this.cleanups[index]();
            }
            catch (error) {
                errors.push({ mechanismName: this.mechanismName, error });
            }
        }
        this.cleanups.length = 0;
        return errors;
    }
}
/** 同一 node visit 中全部 mechanism invocation 的所有者。 */
export class MechanismInvocationGroup {
    descriptor;
    runtimeScopeIsCurrent;
    invocations = [];
    closed = false;
    constructor(descriptor, runtimeScopeIsCurrent) {
        this.descriptor = descriptor;
        this.runtimeScopeIsCurrent = runtimeScopeIsCurrent;
    }
    createScope(mechanismName) {
        if (this.closed)
            throw new Error("mechanism invocation group 已关闭");
        const invocation = new MechanismInvocation(mechanismName, this.descriptor, this.runtimeScopeIsCurrent);
        this.invocations.push(invocation);
        return invocation.scope;
    }
    async close() {
        if (this.closed)
            return [];
        this.closed = true;
        const errors = [];
        for (let index = this.invocations.length - 1; index >= 0; index--) {
            errors.push(...await this.invocations[index].close());
        }
        this.invocations.length = 0;
        return errors;
    }
}
class BrokerSubscription {
    subscriber;
    remove;
    constructor(subscriber, remove) {
        this.subscriber = subscriber;
        this.remove = remove;
    }
    get disposed() {
        return this.subscriber.disposed;
    }
    dispose() {
        if (this.subscriber.disposed)
            return;
        this.subscriber.disposed = true;
        this.remove(this.subscriber);
    }
}
/**
 * pi 每类事件只注册一个底层 handler；node visit 内的订阅由 scope 托管。
 * handler 控制性失败先记录，随后由图循环在安全检查点消费。
 */
export class MechanismEventBroker {
    reportFailure;
    subscribers = new Map([
        ["tool_result", []],
        ["turn_start", []],
        ["turn_end", []],
    ]);
    pendingFailures = [];
    decisionTraces = new Map();
    activeRun = null;
    pi;
    options;
    constructor(pi, reportFailure, options = {}) {
        this.reportFailure = reportFailure;
        this.pi = pi;
        this.options = {
            execRoot: path.resolve(options.execRoot ?? process.cwd()),
            execTimeoutMs: options.execTimeoutMs ?? 30_000,
            execMaxOutputBytes: options.execMaxOutputBytes ?? 64 * 1024,
            allowExecOutsideRoot: options.allowExecOutsideRoot ?? false,
            eventMaxBytes: options.eventMaxBytes ?? 64 * 1024,
            completionValidationTimeoutMs: options.completionValidationTimeoutMs ?? 60_000,
        };
        for (const [name, value] of Object.entries({
            execTimeoutMs: this.options.execTimeoutMs,
            execMaxOutputBytes: this.options.execMaxOutputBytes,
            eventMaxBytes: this.options.eventMaxBytes,
            completionValidationTimeoutMs: this.options.completionValidationTimeoutMs,
        })) {
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error(`MechanismRuntimeOptions.${name} 必须是正整数`);
            }
        }
        pi.on("tool_call", async (event) => this.handleToolCall(event));
        pi.on("tool_execution_start", async (event) => {
            const run = this.activeRun;
            if (!run)
                return;
            const snapshot = Object.freeze({
                ...snapshotEvent(event),
                agentRunId: run.agentRunId,
            });
            await this.invokeObservationHook("onToolStart", "onToolStart", snapshot);
        });
        pi.on("tool_result", async (event) => {
            return this.handleToolResult(event);
        });
        pi.on("turn_start", async (event) => {
            const agentRunId = this.activeRun?.agentRunId ?? null;
            const snapshot = Object.freeze({ ...snapshotEvent(event), agentRunId });
            await this.dispatch("turn_start", snapshot);
            if (agentRunId !== null)
                await this.invokeObservationHook("onTurnStart", "onTurnStart", snapshot);
        });
        pi.on("turn_end", async (event) => {
            const agentRunId = this.activeRun?.agentRunId ?? null;
            const snapshot = Object.freeze({ ...snapshotEvent(event), agentRunId });
            await this.dispatch("turn_end", snapshot);
            if (agentRunId !== null)
                await this.invokeObservationHook("onTurnEnd", "onTurnEnd", snapshot);
        });
    }
    createExec(scope) {
        return Object.freeze({
            run: async (command, args = [], runOptions = {}) => {
                if (!scope.isActive())
                    throw new Error("mechanism scope 已失效，不能执行命令");
                const timeout = runOptions.timeoutMs ?? this.options.execTimeoutMs;
                const maxOutputBytes = runOptions.maxOutputBytes ?? this.options.execMaxOutputBytes;
                if (!Number.isFinite(timeout) || timeout <= 0)
                    throw new Error("exec timeoutMs 必须是正数");
                if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
                    throw new Error("exec maxOutputBytes 必须是正整数");
                }
                const cwd = path.resolve(runOptions.cwd ?? this.options.execRoot);
                if (!this.options.allowExecOutsideRoot && !isWithinPath(this.options.execRoot, cwd)) {
                    throw new Error(`exec cwd 超出受控根目录: ${cwd}`);
                }
                const result = await this.pi.exec(command, [...args], {
                    cwd,
                    timeout,
                    signal: scope.signal,
                });
                const stdout = truncateUtf8(result.stdout, maxOutputBytes);
                const stderr = truncateUtf8(result.stderr, maxOutputBytes);
                return Object.freeze({
                    stdout: stdout.value,
                    stderr: stderr.value,
                    code: result.code,
                    killed: result.killed,
                    stdoutTruncated: stdout.truncated,
                    stderrTruncated: stderr.truncated,
                });
            },
        });
    }
    createDecisionLog(scope) {
        if (!this.decisionTraces.has(scope.scopeId))
            this.decisionTraces.set(scope.scopeId, []);
        scope.onCleanup(() => { this.decisionTraces.delete(scope.scopeId); });
        return Object.freeze({
            list: () => Object.freeze([...(this.decisionTraces.get(scope.scopeId) ?? [])]),
        });
    }
    async beginAgentRun(agentRunId, request, invocations) {
        if (this.activeRun)
            throw new Error("同一 Session 不支持重叠的 runAgent mechanism 生命周期");
        this.activeRun = { agentRunId, invocations };
        const requestView = snapshotEvent({
            prompt: request.prompt,
            ...(request.skill === undefined ? {} : { skill: request.skill }),
            ...(request.outputSchema === undefined ? {} : { outputSchema: request.outputSchema }),
        });
        for (const invocation of invocations) {
            if (invocation.initializationFailure || !invocation.mechanism.beforeAgentRun)
                continue;
            try {
                const context = Object.freeze({
                    ...invocation.context,
                    agentRunId,
                    request: requestView,
                });
                await invocation.mechanism.beforeAgentRun(context);
            }
            catch (error) {
                const failure = this.recordHookFailure(invocation, "beforeAgentRun", error);
                if (failure.policy !== "continue")
                    return { blocked: true, reason: failure.reason };
            }
        }
        return { blocked: false };
    }
    endAgentRun(agentRunId) {
        if (this.activeRun?.agentRunId === agentRunId)
            this.activeRun = null;
    }
    async validateCompletion(agentRunId, completion) {
        const run = this.activeRun;
        if (!run || run.agentRunId !== agentRunId || completion.status !== "ok") {
            return { action: "allow" };
        }
        const checks = [];
        const completionView = Object.freeze({
            nodeId: completion.nodeId,
            status: completion.status,
            result: snapshotEvent(completion.result),
        });
        for (const invocation of run.invocations) {
            const hook = invocation.mechanism.validateCompletion;
            if (invocation.initializationFailure || !hook)
                continue;
            let decision;
            try {
                const context = Object.freeze({
                    ...invocation.context,
                    agentRunId,
                    completion: completionView,
                });
                decision = await withTimeoutAndSignal(Promise.resolve(hook(context)), this.options.completionValidationTimeoutMs, invocation.context.scope.signal, `mechanism "${invocation.mechanism.name}" completion 验收超时`);
            }
            catch (error) {
                const failure = this.recordHookFailure(invocation, "validateCompletion", error);
                if (failure.policy === "continue")
                    continue;
                return {
                    action: failure.policy === "fail-graph" ? "fail-graph" : "fail-node",
                    reason: failure.reason,
                };
            }
            if (decision.action === "allow") {
                if (decision.verifiedResult) {
                    checks.push(Object.freeze({
                        mechanismName: invocation.mechanism.name,
                        result: snapshotEvent(decision.verifiedResult),
                    }));
                }
                continue;
            }
            if (decision.action === "reject") {
                return { action: "reject", reason: decision.reason };
            }
            const failure = this.recordCompletionDecisionFailure(invocation, decision);
            return { action: decision.action, reason: failure.reason };
        }
        if (checks.length === 0)
            return { action: "allow" };
        return {
            action: "allow",
            verifiedResult: Object.freeze({ checks: Object.freeze(checks) }),
        };
    }
    createEvents(mechanismName, policy, scope) {
        return Object.freeze({
            onToolResult: (handler) => this.subscribe("tool_result", mechanismName, policy, scope, handler),
            onTurnStart: (handler) => this.subscribe("turn_start", mechanismName, policy, scope, handler),
            onTurnEnd: (handler) => this.subscribe("turn_end", mechanismName, policy, scope, handler),
        });
    }
    consumeControlFailures(scopeId) {
        const consumed = [];
        for (let index = this.pendingFailures.length - 1; index >= 0; index--) {
            if (this.pendingFailures[index].scopeId !== scopeId)
                continue;
            consumed.unshift(this.pendingFailures[index]);
            this.pendingFailures.splice(index, 1);
        }
        return consumed;
    }
    async handleToolCall(event) {
        const run = this.activeRun;
        if (!run)
            return;
        let currentInput = snapshotEvent(event.input);
        for (const invocation of run.invocations) {
            const hook = invocation.mechanism.beforeToolCall;
            if (invocation.initializationFailure || !hook)
                continue;
            const eventView = Object.freeze({
                type: "tool_call",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: currentInput,
                agentRunId: run.agentRunId,
            });
            let decision;
            try {
                decision = await hook(Object.freeze({
                    ...invocation.context,
                    agentRunId: run.agentRunId,
                    event: eventView,
                }));
            }
            catch (error) {
                const failure = this.recordHookFailure(invocation, "beforeToolCall", error);
                if (failure.policy !== "continue")
                    return { block: true, reason: failure.reason };
                continue;
            }
            if (!decision || decision.action === "allow") {
                this.recordDecision(invocation, event, run.agentRunId, "tool-allow");
                continue;
            }
            if (decision.action === "deny") {
                const reason = decision.reason.trim() || `mechanism ${invocation.mechanism.name} 阻止了工具调用`;
                this.recordDecision(invocation, event, run.agentRunId, "tool-deny", reason);
                return { block: true, reason };
            }
            if (event.toolName === "__graph_complete__") {
                const reason = "__graph_complete__ 使用固定 ABI，不允许一般 mechanism patch";
                this.recordDecision(invocation, event, run.agentRunId, "tool-deny", reason);
                return { block: true, reason };
            }
            const patched = snapshotEvent(decision.input);
            const validationError = this.validateToolInput(event.toolName, patched);
            if (validationError) {
                const reason = `工具参数 patch 被拒绝: ${validationError}`;
                this.recordDecision(invocation, event, run.agentRunId, "tool-deny", reason);
                return { block: true, reason };
            }
            currentInput = patched;
            this.recordDecision(invocation, event, run.agentRunId, "tool-patch");
        }
        if (currentInput !== event.input) {
            const mutableInput = event.input;
            for (const key of Object.keys(mutableInput))
                delete mutableInput[key];
            Object.assign(mutableInput, currentInput);
        }
    }
    async handleToolResult(event) {
        const run = this.activeRun;
        let content = event.content;
        let isError = event.isError;
        if (run) {
            for (const invocation of run.invocations) {
                const hook = invocation.mechanism.afterToolResult;
                if (invocation.initializationFailure || !hook)
                    continue;
                const view = this.createToolResultView(event, run.agentRunId, content, isError);
                let decision;
                try {
                    decision = await hook(Object.freeze({
                        ...invocation.context,
                        agentRunId: run.agentRunId,
                        event: view,
                    }));
                }
                catch (error) {
                    const failure = this.recordHookFailure(invocation, "afterToolResult", error);
                    if (failure.policy !== "continue") {
                        content = [{ type: "text", text: failure.reason }];
                        isError = true;
                    }
                    continue;
                }
                if (!decision || decision.action === "keep") {
                    this.recordDecision(invocation, event, run.agentRunId, "tool-result-keep");
                    continue;
                }
                if (decision.content)
                    content = [...decision.content];
                if (decision.isError !== undefined)
                    isError = decision.isError;
                this.recordDecision(invocation, event, run.agentRunId, "tool-result-replace");
            }
        }
        const agentRunId = run?.agentRunId ?? null;
        const finalView = this.createToolResultView(event, agentRunId, content, isError);
        await this.dispatch("tool_result", finalView);
        if (run)
            await this.invokeObservationHook("onToolResult", "onToolResult", finalView);
        if (content !== event.content || isError !== event.isError)
            return { content, isError };
    }
    createToolResultView(event, agentRunId, content, isError) {
        const budgeted = snapshotWithBudget({ ...event, content, isError }, this.options.eventMaxBytes);
        return Object.freeze({
            ...budgeted.value,
            agentRunId,
            truncated: budgeted.truncated,
        });
    }
    async invokeObservationHook(hookName, phase, event) {
        const run = this.activeRun;
        if (!run)
            return;
        for (const invocation of run.invocations) {
            const hook = invocation.mechanism[hookName];
            if (invocation.initializationFailure || !hook)
                continue;
            try {
                await hook(Object.freeze({
                    ...invocation.context,
                    agentRunId: run.agentRunId,
                    event,
                }));
            }
            catch (error) {
                this.recordHookFailure(invocation, phase, error);
            }
        }
    }
    validateToolInput(toolName, input) {
        const tool = this.pi.getAllTools().find((candidate) => candidate.name === toolName);
        if (!tool?.parameters)
            return `工具 ${toolName} 没有可用 schema`;
        try {
            const validator = Schema.Compile(tool.parameters);
            const [isValid, errors] = validator.Errors(input);
            if (isValid)
                return null;
            return errors.slice(0, 3).map((item) => `${item.instancePath || "$"} ${item.message}`).join("; ");
        }
        catch (error) {
            return `工具 ${toolName} schema 无法安全编译: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    recordHookFailure(invocation, phase, error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = {
            mechanismName: invocation.mechanism.name,
            phase,
            policy: invocation.mechanism.failurePolicy ?? "continue",
            error,
            reason: `mechanism "${invocation.mechanism.name}" ${phase} 失败: ${message}`,
            scopeId: invocation.context.scope.scopeId,
        };
        this.reportFailure(failure);
        if (failure.policy !== "continue" && invocation.context.scope.isActive()) {
            this.pendingFailures.push(failure);
        }
        return failure;
    }
    recordCompletionDecisionFailure(invocation, decision) {
        const policy = decision.action;
        const failure = {
            mechanismName: invocation.mechanism.name,
            phase: "validateCompletion",
            policy,
            error: new Error(decision.reason),
            reason: `mechanism "${invocation.mechanism.name}" completion gate ${decision.action}: ${decision.reason}`,
            scopeId: invocation.context.scope.scopeId,
        };
        this.reportFailure(failure);
        if (invocation.context.scope.isActive())
            this.pendingFailures.push(failure);
        return failure;
    }
    recordDecision(invocation, event, agentRunId, decision, reason) {
        const list = this.decisionTraces.get(invocation.context.scope.scopeId);
        if (!list)
            return;
        list.push(Object.freeze({
            timestamp: Date.now(),
            agentRunId,
            mechanismName: invocation.mechanism.name,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            decision,
            ...(reason === undefined ? {} : { reason }),
        }));
    }
    subscribe(eventName, mechanismName, policy, scope, handler) {
        const subscriber = {
            eventName,
            mechanismName,
            policy,
            scope,
            handler: (event) => handler(event),
            disposed: false,
        };
        this.subscribers.get(eventName).push(subscriber);
        const subscription = new BrokerSubscription(subscriber, (item) => this.removeSubscriber(item));
        scope.onCleanup(() => subscription.dispose());
        return subscription;
    }
    removeSubscriber(subscriber) {
        const list = this.subscribers.get(subscriber.eventName);
        const index = list.indexOf(subscriber);
        if (index >= 0)
            list.splice(index, 1);
    }
    async dispatch(eventName, event) {
        const snapshot = [...this.subscribers.get(eventName)];
        for (const subscriber of snapshot) {
            if (subscriber.disposed || !subscriber.scope.isActive())
                continue;
            try {
                await subscriber.handler(event);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const failure = {
                    mechanismName: subscriber.mechanismName,
                    phase: eventName,
                    policy: subscriber.policy,
                    error,
                    reason: `mechanism "${subscriber.mechanismName}" ${eventName} handler 失败: ${message}`,
                    scopeId: subscriber.scope.scopeId,
                };
                this.reportFailure(failure);
                if (subscriber.policy !== "continue" && subscriber.scope.isActive()) {
                    this.pendingFailures.push(failure);
                }
            }
        }
    }
}
function snapshotEvent(value) {
    return snapshotValue(value, new WeakMap());
}
function snapshotValue(value, seen) {
    if (value === null || typeof value !== "object")
        return value;
    const cached = seen.get(value);
    if (cached)
        return cached;
    if (Array.isArray(value)) {
        const copy = [];
        seen.set(value, copy);
        for (const item of value)
            copy.push(snapshotValue(item, seen));
        return Object.freeze(copy);
    }
    if (value instanceof Date)
        return Object.freeze(new Date(value.getTime()));
    if (value instanceof Map) {
        const copy = new Map();
        seen.set(value, copy);
        for (const [key, item] of value) {
            copy.set(snapshotValue(key, seen), snapshotValue(item, seen));
        }
        return copy;
    }
    if (value instanceof Set) {
        const copy = new Set();
        seen.set(value, copy);
        for (const item of value)
            copy.add(snapshotValue(item, seen));
        return copy;
    }
    const copy = {};
    seen.set(value, copy);
    for (const key of Object.keys(value)) {
        copy[key] = snapshotValue(value[key], seen);
    }
    return Object.freeze(copy);
}
function isWithinPath(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function truncateUtf8(value, maxBytes) {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maxBytes)
        return { value, truncated: false };
    return { value: bytes.subarray(0, maxBytes).toString("utf8"), truncated: true };
}
function snapshotWithBudget(value, maxBytes) {
    let remaining = maxBytes;
    let truncated = false;
    const visit = (item, seen) => {
        if (typeof item === "string") {
            const result = truncateUtf8(item, Math.max(0, remaining));
            remaining -= Buffer.byteLength(result.value, "utf8");
            if (result.truncated)
                truncated = true;
            return result.value;
        }
        if (item === null || typeof item !== "object")
            return item;
        const cached = seen.get(item);
        if (cached)
            return cached;
        if (Array.isArray(item)) {
            const copy = [];
            seen.set(item, copy);
            for (const child of item)
                copy.push(visit(child, seen));
            return Object.freeze(copy);
        }
        const copy = {};
        seen.set(item, copy);
        for (const key of Object.keys(item))
            copy[key] = visit(item[key], seen);
        return Object.freeze(copy);
    };
    return { value: visit(value, new WeakMap()), truncated };
}
async function withTimeoutAndSignal(promise, timeoutMs, signal, timeoutMessage) {
    if (signal.aborted)
        throw new Error("mechanism scope 已取消");
    let timeout;
    let abortHandler;
    const guard = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        abortHandler = () => reject(new Error("mechanism scope 已取消"));
        signal.addEventListener("abort", abortHandler, { once: true });
    });
    try {
        return await Promise.race([promise, guard]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        if (abortHandler)
            signal.removeEventListener("abort", abortHandler);
    }
}
