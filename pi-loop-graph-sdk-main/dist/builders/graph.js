import { defineGraph } from "../core/graph.js";
export { defineGraph } from "../core/graph.js";
export function defineSingleAgentGraph(input) {
    const stages = {
        main: {
            node: input.node,
            route: {
                kind: "first-match",
                connections: [{
                        id: "finish",
                        to: "__graph_finish__",
                        transition: { output: ({ completion }) => completion.result },
                    }],
            },
        },
    };
    return defineGraph({ ...input, entries: [{ id: "main", to: "main" }], stages });
}
export function defineLinearGraph(input) {
    const stages = {};
    input.nodes.forEach((node, index) => {
        const id = node.identity?.name ?? `stage-${index + 1}`;
        const next = input.nodes[index + 1]?.identity?.name ?? (index + 1 < input.nodes.length ? `stage-${index + 2}` : "__graph_finish__");
        stages[id] = {
            node,
            route: {
                kind: "first-match",
                connections: [{
                        id: next === "__graph_finish__" ? "finish" : `to-${next}`,
                        to: next,
                        transition: next === "__graph_finish__"
                            ? { output: ({ completion }) => completion.result }
                            : { map: ({ completion }) => completion.result },
                    }],
            },
        };
    });
    return defineGraph({ ...input, entries: [{ id: "main", to: Object.keys(stages)[0] ?? "" }], stages });
}
