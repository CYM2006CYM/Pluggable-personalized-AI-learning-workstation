// ============================================================
//  Loop Graph SDK — 核心类型定义
// ============================================================
//
//  栈式子图编排
//
//    AgentInstance 持有一个有序逻辑帧栈（frames），节点离开时由边折叠；
//    compose 以有界 frame segment 实现结构化生长与归约。
//
//    子图调用是一等公民：Node 可以引用另一个 Graph 作为其实现。
//    graph node 缺省使用 call：Runtime 为子图创建新的 AgentInstance；
//    compose 已可执行；delegate 保留在类型协议中，待独立 host 接线。
//
// ============================================================
// ── 终止标记 ──
/**
 * 图的终止标记，也是图的「返回」出口。
 *
 * 当一条边的 to 指向 END，Runtime 弹出当前图的栈帧，
 * 并将该边 migrate 产出的 output 作为本图的返回值：
 *   · 子图调用   → 成为父图 kind="graph" 节点的 NodeCompletion.result
 *   · tool 调用  → 成为返回给 agent 的工具结果
 *   · 顶层调用   → 成为整次运行的最终产出
 *
 * 向后兼容：未声明 output 时依次回退到 frame.status/result、completion。
 *
 * END 边的 migrate 承担双重身份——既自由定义最后一层工作记忆，
 * 又通过 output 声明「这张图对外交付什么」。
 */
export const END = Symbol("graph.end");
