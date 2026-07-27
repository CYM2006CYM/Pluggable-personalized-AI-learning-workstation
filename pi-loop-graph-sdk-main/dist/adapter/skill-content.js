import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const defaultSkillContentProvider = async (ref, context) => {
    try {
        return await readFile(join(context.basePath, ref, "SKILL.md"), "utf8");
    }
    catch (error) {
        if (error?.code === "ENOENT")
            return null;
        throw error;
    }
};
export const defaultSkillContentRenderer = (ref, content) => ({
    kind: "skill",
    content: `[skill: ${ref}]\n\n${content}`,
});
