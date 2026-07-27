export function skillRef(name, version, required = true) {
    if (!name)
        throw new Error("SkillRef requires a name");
    return Object.freeze({ name, version, required });
}
export function toolSet(...names) {
    if (new Set(names).size !== names.length)
        throw new Error("ToolSet contains duplicate names");
    return Object.freeze([...names]);
}
