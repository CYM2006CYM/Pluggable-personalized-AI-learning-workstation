// ============================================================
//  Debug Logger — 记录每层的输入、输出、帧栈
// ============================================================
//
//  输出到项目根目录 loop-graph-debug.log（JSONL 格式）。
//  每条日志含 timestamp + type + data。
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
const LOG_PATH = path.resolve("loop-graph-debug.log");
let fileOpened = false;
/** 截断序列化帧的预览，避免日志爆量。 */
export function safePreview(value, maxLength = 500) {
    try {
        const s = JSON.stringify(value);
        if (s === undefined)
            return "[unserializable]";
        return s.length <= maxLength ? s : s.slice(0, maxLength) + "…";
    }
    catch {
        return "[unserializable]";
    }
}
function log(entry) {
    // 文件调试是显式 opt-in；正常 SDK 使用不产生工作区文件。
    if (process.env.PI_LOOP_GRAPH_DEBUG !== "1")
        return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    if (!fileOpened) {
        fs.writeFileSync(LOG_PATH, "", "utf-8");
        fileOpened = true;
    }
    fs.appendFileSync(LOG_PATH, line + "\n", "utf-8");
}
export const debugLog = {
    preview(value, maxLength) {
        return safePreview(value, maxLength);
    },
    /** 图启动 */
    graphStart(graphId, trigger) {
        log({ type: "graph_start", graphId, trigger });
    },
    /** 进入节点 */
    enterNode(depth, nodeId, scopeId, input, frames) {
        log({
            type: "enter_node",
            depth,
            nodeId,
            scopeId,
            inputData: input.data,
            frameCount: frames.length,
        });
    },
    /** 退出节点（折叠帧）。控制信息来自 completion；frame 作为 opaque payload。 */
    exitNode(depth, nodeId, completion, frame, allFrames) {
        log({
            type: "exit_node",
            depth,
            nodeId,
            status: completion.status,
            resultKeys: Object.keys(completion.result),
            framePreview: safePreview(frame),
            totalFrames: allFrames.length,
        });
    },
    /** context 钩子投影 */
    projection(input, output) {
        log({
            type: "projection",
            messageCount: input.messages.length,
            scopeId: input.activeScope?.scopeId ?? null,
            splitFound: input.activeScope
                ? input.messages.some((m) => m.customType === "loop_graph_node_scope" &&
                    m.details?.scopeId === input.activeScope?.scopeId)
                : false,
            frameCount: input.frames.length,
            currentNode: input.currentNode?.id ?? null,
            frameMsgCount: output.filter((m) => typeof m.content === "string" && m.content.startsWith("=== COMPLETED")).length,
            currentMsgCount: output.filter((m) => typeof m.content === "string" && m.content.startsWith("=== CURRENT")).length,
            otherCount: output.filter((m) => typeof m.content !== "string" || !m.content.startsWith("===")).length,
            messageTypes: output.slice(0, 8).map((m) => m.customType ?? m.role ?? "?"),
        });
    },
    /** 图运行期间发生 compaction 后记录 checkpoint 信息。 */
    scopeCheckpoint(scopeId, generation, reason, willRetry) {
        log({ type: "scope_checkpoint", scopeId, generation, reason, willRetry });
    },
    /** 共享 Session 的嵌套调用期间阻止 compaction 跨越 GraphCallScope。 */
    compactionBlocked(reason, depth) {
        log({ type: "compaction_blocked", reason, depth });
    },
    /** agent 完成（__graph_complete__ 被调用） */
    agentComplete(nodeId, completion) {
        log({
            type: "agent_complete",
            nodeId,
            status: completion.status,
            resultKeys: Object.keys(completion.result),
        });
    },
    /** agent 未调用 __graph_complete__ 就结束 */
    agentIncomplete(nodeId) {
        log({ type: "agent_incomplete", nodeId });
    },
    /** 完成验证不通过，触发重试 */
    agentRetry(nodeId, reason) {
        log({ type: "agent_retry", nodeId, reason });
    },
    /** 图结束。控制信息来自 result；frames 作为 opaque payload。 */
    graphEnd(graphId, steps, resultStatus, resultPreview, frames) {
        log({
            type: "graph_end",
            graphId,
            steps,
            status: resultStatus,
            resultPreview,
            frameCount: frames.length,
        });
    },
    /** 图错误 */
    graphError(graphId, error) {
        log({ type: "graph_error", graphId, error });
    },
    /** 子图 push */
    subgraphPush(parentNodeId, childGraphId) {
        log({ type: "subgraph_push", parentNodeId, childGraphId });
    },
    /** 子图 pop */
    subgraphPop(parentNodeId, childGraphId, result) {
        log({ type: "subgraph_pop", parentNodeId, childGraphId, resultKeys: typeof result === "object" && result ? Object.keys(result) : [] });
    },
    frameSegmentStart(graphId, parentNodeId, baseIndex, depth) {
        log({ type: "frame_segment_start", graphId, parentNodeId, baseIndex, depth });
    },
    frameSegmentClose(graphId, parentNodeId, frames, completion) {
        log({
            type: "frame_segment_close",
            graphId,
            parentNodeId,
            frameCount: frames.length,
            foldedCompletion: completion,
        });
    },
    frameSegmentRollback(graphId, parentNodeId, reason) {
        log({ type: "frame_segment_rollback", graphId, parentNodeId, reason });
    },
    /** 工具切换 */
    toolsChanged(nodeId, tools) {
        log({ type: "tools_changed", nodeId, tools });
    },
};
