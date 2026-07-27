export function entry(id, config) {
    return Object.freeze({ id, ...config });
}
export function defineTransition(transition) {
    return Object.freeze({ ...transition });
}
export function connect(to, transition = {}) {
    return Object.freeze({ to, transition });
}
export function finish(transition = {}) {
    return Object.freeze({ to: "__graph_finish__", transition });
}
export function firstMatch(connections) {
    return Object.freeze({
        kind: "first-match",
        connections: Object.freeze(Object.entries(connections).map(([id, connection]) => Object.freeze({ id, ...connection }))),
    });
}
