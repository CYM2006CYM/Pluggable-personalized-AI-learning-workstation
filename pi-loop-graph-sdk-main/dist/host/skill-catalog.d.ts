import type { ResolvedSkillView, SkillRef } from "../core/skill.js";
export interface SkillRegistration {
    readonly name: string;
    readonly version?: string;
    readonly source: string;
    readonly content: string;
}
export interface SkillResolver {
    resolve(ref: SkillRef): SkillRegistration | undefined;
}
export type SkillResolverFunction = (ref: SkillRef) => SkillRegistration | undefined;
export interface SkillCatalogOptions {
    readonly resolver?: SkillResolver | SkillResolverFunction;
}
export declare class SkillCatalog implements SkillResolver {
    private readonly options;
    private readonly skills;
    private readonly misses;
    constructor(options?: SkillCatalogOptions);
    register(skill: SkillRegistration): void;
    resolve(ref: SkillRef): ResolvedSkillView | undefined;
    loadPaths(paths: readonly string[]): Promise<void>;
    private loadPath;
}
