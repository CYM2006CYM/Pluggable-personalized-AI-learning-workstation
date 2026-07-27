export function defineMechanism(mechanism) {
    if (!mechanism.name.trim())
        throw new Error("Mechanism name is required");
    return Object.freeze({ ...mechanism });
}
