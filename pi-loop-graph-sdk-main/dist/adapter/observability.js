import * as fs from "node:fs";
import * as path from "node:path";
/** 观测失败不得改变图控制流。 */
export function emitLifecycleEvent(event, traceSink, logger) {
    try {
        const pending = traceSink?.(event);
        if (pending && typeof pending.catch === "function") {
            void pending.catch(() => { });
        }
    }
    catch {
        // observability is best-effort
    }
    try {
        const message = `[loop-graph] ${event.type}`;
        if (event.type === "graph_error")
            logger?.error?.(message, event);
        else
            logger?.debug?.(message, event);
    }
    catch {
        // logger failures are isolated from execution
    }
}
/** debug 模式使用的 JSONL sink；创建时不会清空已有文件。 */
export function createJsonlTraceSink(filePath = path.resolve("loop-graph-debug.log")) {
    const resolved = path.resolve(filePath);
    return (event) => {
        fs.appendFileSync(resolved, `${JSON.stringify(event)}\n`, "utf8");
    };
}
