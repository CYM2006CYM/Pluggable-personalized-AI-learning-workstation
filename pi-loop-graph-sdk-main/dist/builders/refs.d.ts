import type { SkillRef } from "../core/skill.js";
export type { SkillRef } from "../core/skill.js";
export type ToolSet<TNames extends readonly string[] = readonly string[]> = TNames;
export declare function skillRef(name: string, version?: string, required?: boolean): SkillRef;
export declare function toolSet<const TNames extends readonly string[]>(...names: TNames): ToolSet<TNames>;
