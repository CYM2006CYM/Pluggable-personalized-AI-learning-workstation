export function agentNode(input) {
    return Object.freeze({ ...input, kind: "agent" });
}
export function codeNode(input) {
    return Object.freeze({ ...input, kind: "code" });
}
export function graphNode(input) {
    return Object.freeze({ ...input, kind: "graph", boundary: input.boundary ?? "call" });
}
