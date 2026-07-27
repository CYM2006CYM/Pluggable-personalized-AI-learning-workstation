import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { isJsonValue } from "../core/json.js";
const execFileAsync = promisify(execFile);
export class MechanismRuntimeError extends Error {
    failure;
    constructor(failure) {
        super(failure.message);
        this.failure = failure;
        this.name = "MechanismRuntimeError";
    }
}
export class MechanismRuntime {
    warn;
    options;
    activeNames = [];
    decisions = [];
    failures = [];
    unmanagedWarningEmitted = false;
    contributions = new Map();
    agentRunHandles = null;
    naturalLifetime;
    constructor(options = {}, warn) {
        this.warn = warn;
        this.options = {
            hookTimeoutMs: options.hookTimeoutMs ?? 30_000,
            execRoot: path.resolve(options.execRoot ?? process.cwd()),
            execTimeoutMs: options.execTimeoutMs ?? 30_000,
            execMaxOutputBytes: options.execMaxOutputBytes ?? 64 * 1024,
            allowExecOutsideRoot: options.allowExecOutsideRoot ?? false,
            pi: options.pi,
        };
    }
    get decisionTrace() { return Object.freeze([...this.decisions]); }
    get failureTrace() { return Object.freeze([...this.failures]); }
    get contextContributions() { return Object.freeze([...this.contributions.values()]); }
    async open(installation, scopeId, definitions, identity, _contextState) {
        this.validateDuplicates(definitions);
        const invocations = [];
        try {
            for (const definition of definitions) {
                if (!definition.allowMultiple && this.activeNames.includes(definition.name)) {
                    throw this.error(definition, installation, "createState", scopeId, new Error(`Mechanism is already installed in the active chain: ${definition.name}`));
                }
                let state;
                try {
                    state = definition.createState?.() ?? {};
                    if (!isJsonValue(state))
                        throw new Error("Mechanism state must be JSON-compatible");
                }
                catch (error) {
                    throw this.error(definition, installation, "createState", scopeId, error);
                }
                const scope = new ManagedScope(scopeId, installation);
                const context = this.createContext(definition, installation, identity, state, scope);
                invocations.push({ definition, installation, context, scope });
                this.activeNames.push(definition.name);
            }
            return Object.freeze({ invocations: Object.freeze(invocations) });
        }
        catch (error) {
            await this.close(Object.freeze({ invocations: Object.freeze(invocations) }));
            throw error;
        }
    }
    async beforeAgentRun(chains, agentRunId, prompt) {
        this.agentRunHandles = [];
        for (const invocation of flatten(chains)) {
            const hook = invocation.definition.beforeAgentRun;
            if (!hook)
                continue;
            this.naturalLifetime = "agent-run";
            try {
                await this.control(invocation, "beforeAgentRun", () => hook(Object.freeze({ ...invocation.context, agentRunId, prompt })));
            }
            finally {
                this.naturalLifetime = undefined;
            }
        }
    }
    async afterAgentRun(chains, agentRunId) {
        for (const invocation of [...flatten(chains)].reverse()) {
            const hook = invocation.definition.afterAgentRun;
            if (!hook)
                continue;
            await this.observeInvocation(invocation, "afterAgentRun", () => hook(Object.freeze({ ...invocation.context, agentRunId })));
        }
        for (const handle of this.agentRunHandles ?? [])
            handle.dispose();
        this.agentRunHandles = null;
    }
    async enter(chains, hookName) {
        for (const invocation of flatten(chains)) {
            const hook = invocation.definition[hookName];
            if (hook)
                await this.observeInvocation(invocation, hookName, () => hook(invocation.context));
        }
    }
    async validateCompletion(chains, agentRunId, completion) {
        for (const invocation of [...flatten(chains)].reverse()) {
            const hook = invocation.definition.validateCompletion;
            if (!hook)
                continue;
            const decision = await this.control(invocation, "validateCompletion", () => hook(Object.freeze({ ...invocation.context, agentRunId, completion })));
            this.decisions.push(Object.freeze({
                mechanismName: invocation.definition.name,
                hook: "validateCompletion",
                decision: decision.action,
                reason: "reason" in decision ? decision.reason : undefined,
                timestamp: Date.now(),
            }));
            if (decision.action !== "allow")
                return decision;
        }
        return { action: "allow" };
    }
    async nodeExit(chains, completion) {
        for (const invocation of [...flatten(chains)].reverse()) {
            const hook = invocation.definition.onNodeExit;
            if (hook)
                await this.observeInvocation(invocation, "onNodeExit", () => hook(Object.freeze({ ...invocation.context, completion })));
        }
    }
    async nodeError(chains, error) {
        for (const invocation of [...flatten(chains)].reverse()) {
            const hook = invocation.definition.onNodeError;
            if (hook)
                await this.observeInvocation(invocation, "onNodeError", () => hook(Object.freeze({ ...invocation.context, error })));
        }
    }
    async graphExit(chains, error) {
        for (const invocation of [...flatten(chains)].reverse()) {
            const hook = error === undefined ? invocation.definition.onGraphExit : invocation.definition.onGraphError;
            const name = error === undefined ? "onGraphExit" : "onGraphError";
            if (hook)
                await this.observeInvocation(invocation, name, () => hook(Object.freeze({ ...invocation.context, ...(error === undefined ? {} : { error }) })));
        }
    }
    async rootExit(chain) {
        for (const invocation of [...chain.invocations].reverse()) {
            const hook = invocation.definition.onRootExit;
            if (hook)
                await this.observeInvocation(invocation, "onRootExit", () => hook(invocation.context));
        }
    }
    async close(chain) {
        for (const invocation of [...chain.invocations].reverse()) {
            const errors = await invocation.scope.close();
            for (const error of errors)
                this.record(invocation, "cleanup", error);
            const index = this.activeNames.lastIndexOf(invocation.definition.name);
            if (index >= 0)
                this.activeNames.splice(index, 1);
        }
    }
    /** Yield JSON-compatible snapshots for all mechanisms that implement snapshot. */
    snapshotAll(chains) {
        const snapshots = [];
        for (const invocation of flatten(chains)) {
            if (invocation.definition.snapshot) {
                try {
                    const snapshot = invocation.definition.snapshot(invocation.context.state);
                    if (!isJsonValue(snapshot))
                        throw new Error("Mechanism snapshot must be JSON-compatible");
                    snapshots.push({ name: invocation.definition.name, snapshot });
                }
                catch (error) {
                    // Observation: snapshots are best-effort; failure does not alter control flow.
                    const message = `Mechanism "${invocation.definition.name}" snapshot failed: ${error instanceof Error ? error.message : String(error)}`;
                    this.warn?.(message);
                }
            }
        }
        return Object.freeze(snapshots);
    }
    /** Restore mechanism state from a checkpoint. A declared restore hook is fail-closed. */
    restoreState(chains, saved) {
        const snapshotMap = new Map(saved.map((s) => [s.name, s.snapshot]));
        for (const invocation of flatten(chains)) {
            if (!invocation.definition.restore)
                continue;
            const snapshot = snapshotMap.get(invocation.definition.name);
            if (snapshot === undefined)
                continue;
            try {
                const restored = invocation.definition.restore(snapshot);
                if (!isJsonValue(restored))
                    throw new Error("Restored mechanism state must be JSON-compatible");
                invocation.context.state = restored;
            }
            catch (error) {
                throw this.error(invocation.definition, invocation.installation, "createState", invocation.scope.scopeId, new Error(`checkpoint restore failed: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
    }
    async observe(chain, hookName) {
        for (const invocation of chain.invocations) {
            const hook = invocation.definition[hookName];
            if (hook)
                await this.observeInvocation(invocation, hookName, () => hook(invocation.context));
        }
    }
    async observeInvocation(invocation, hook, run) {
        try {
            await withTimeout(Promise.resolve(run()), this.options.hookTimeoutMs, hook);
        }
        catch (error) {
            this.record(invocation, hook, error);
        }
    }
    async control(invocation, hook, run) {
        try {
            return await withTimeout(Promise.resolve(run()), this.options.hookTimeoutMs, hook);
        }
        catch (error) {
            throw this.error(invocation.definition, invocation.installation, hook, invocation.scope.scopeId, error);
        }
    }
    createContext(definition, installation, identity, state, scope) {
        const maxLifetime = installation === "host" ? "root-run" : installation === "graph" ? "graph-invocation" : "node-visit";
        const defaultLifetime = installation === "host" ? "root-run" : installation === "graph" ? "graph-invocation" : "node-visit";
        const context = {
            add: (id, content, options = {}) => {
                const lifetime = options.lifetime ?? this.naturalLifetime ?? defaultLifetime;
                if (!lifetimeAllowed(lifetime, maxLifetime))
                    throw new Error(`${installation} Mechanism cannot create ${lifetime} contribution`);
                const contributionId = `${scope.scopeId}:${definition.name}:${id}`;
                if (this.contributions.has(contributionId))
                    throw new Error(`Context contribution already exists: ${contributionId}`);
                const contribution = Object.freeze({
                    id: contributionId,
                    owner: installation,
                    scopeId: scope.scopeId,
                    lifetime,
                    retention: options.retention ?? "sticky",
                    content,
                });
                this.contributions.set(contributionId, contribution);
                let active = true;
                const handle = Object.freeze({
                    id: contributionId,
                    update: (next) => {
                        if (!active)
                            throw new Error(`Context contribution is disposed: ${contributionId}`);
                        this.contributions.set(contributionId, Object.freeze({ ...contribution, content: next }));
                    },
                    dispose: () => {
                        if (!active)
                            return;
                        active = false;
                        this.contributions.delete(contributionId);
                    },
                });
                scope.view.onCleanup(() => handle.dispose());
                if (lifetime === "agent-run")
                    this.agentRunHandles?.push(handle);
                return handle;
            },
        };
        const result = {
            ...identity,
            state,
            scope: scope.view,
            context: Object.freeze(context),
            exec: Object.freeze({ run: (file, args, options) => this.exec(file, args, options) }),
        };
        if (this.options.pi !== undefined)
            Object.defineProperty(result, "pi", {
                enumerable: true,
                get: () => {
                    if (!this.unmanagedWarningEmitted) {
                        this.unmanagedWarningEmitted = true;
                        this.warn?.("Mechanism accessed unmanaged ctx.pi; scope, replay, and cleanup guarantees do not apply");
                    }
                    return this.options.pi;
                },
            });
        return Object.freeze(result);
    }
    async exec(file, args = [], options = {}) {
        const cwd = path.resolve(options.cwd ?? this.options.execRoot);
        if (!this.options.allowExecOutsideRoot && !within(this.options.execRoot, cwd))
            throw new Error("Mechanism exec cwd is outside execRoot");
        try {
            const result = await execFileAsync(file, [...args], { cwd, timeout: options.timeoutMs ?? this.options.execTimeoutMs, maxBuffer: this.options.execMaxOutputBytes * 2 });
            return output(0, result.stdout, result.stderr, this.options.execMaxOutputBytes);
        }
        catch (error) {
            const value = error;
            return output(typeof value.code === "number" ? value.code : 1, value.stdout ?? "", value.stderr ?? String(error), this.options.execMaxOutputBytes);
        }
    }
    validateDuplicates(definitions) {
        const names = new Set();
        for (const definition of definitions) {
            if (!definition.name.trim())
                throw new Error("Mechanism name is required");
            if (!definition.allowMultiple && names.has(definition.name))
                throw new Error(`Duplicate Mechanism installation: ${definition.name}`);
            names.add(definition.name);
        }
    }
    record(invocation, hook, error) {
        const failure = this.failure(invocation.definition, invocation.installation, hook, invocation.scope.scopeId, error);
        this.failures.push(failure);
        return failure;
    }
    error(definition, installation, hook, scopeId, error) {
        const failure = this.failure(definition, installation, hook, scopeId, error);
        this.failures.push(failure);
        return new MechanismRuntimeError(failure);
    }
    failure(definition, installation, hook, scopeId, error) {
        return Object.freeze({
            mechanismName: definition.name,
            installation,
            hook,
            policy: definition.failurePolicy ?? (installation === "node" ? "fail-node" : "fail-graph"),
            message: `Mechanism "${definition.name}" ${hook} failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
            scopeId,
        });
    }
}
class ManagedScope {
    scopeId;
    active = true;
    controller = new AbortController();
    cleanups = [];
    view;
    constructor(scopeId, installation) {
        this.scopeId = scopeId;
        this.view = Object.freeze({
            scopeId, installation, signal: this.controller.signal,
            isActive: () => this.active,
            onCleanup: (cleanup) => {
                if (!this.active)
                    throw new Error("Mechanism scope is closed");
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
        for (const cleanup of [...this.cleanups].reverse())
            try {
                await cleanup();
            }
            catch (error) {
                errors.push(error);
            }
        return errors;
    }
}
function flatten(chains) { return chains.flatMap((chain) => [...chain.invocations]); }
function lifetimeAllowed(requested, maximum) {
    const order = ["agent-run", "node-visit", "graph-invocation", "root-run"];
    return order.indexOf(requested) <= order.indexOf(maximum);
}
function within(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
function output(exitCode, stdout, stderr, max) {
    const truncate = (value) => {
        const buffer = Buffer.from(value, "utf8");
        return buffer.length <= max ? { value, truncated: false } : { value: buffer.subarray(0, max).toString("utf8"), truncated: true };
    };
    const out = truncate(stdout);
    const err = truncate(stderr);
    return Object.freeze({ exitCode, stdout: out.value, stderr: err.value, truncated: out.truncated || err.truncated });
}
async function withTimeout(promise, timeoutMs, hook) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${hook} timed out after ${timeoutMs}ms`)), timeoutMs); })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
