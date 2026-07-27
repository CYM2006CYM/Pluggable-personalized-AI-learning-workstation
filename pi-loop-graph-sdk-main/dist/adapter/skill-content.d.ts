import type { GraphContextView, NodeContextView, NodeInputView, RenderedContextMessage } from "./projection.js";
export interface SkillLoadContext {
    readonly graph: GraphContextView;
    readonly node: NodeContextView;
    readonly input: NodeInputView;
    readonly basePath: string;
}
export type SkillContentProvider = (ref: string, context: SkillLoadContext) => Promise<string | null>;
export type SkillContentRenderer = (ref: string, content: string, context: SkillLoadContext) => RenderedContextMessage | null;
export type SkillFailurePolicy = "ignore" | "fail";
export interface SkillFailurePolicies {
    missing?: SkillFailurePolicy;
    error?: SkillFailurePolicy;
}
export declare const defaultSkillContentProvider: SkillContentProvider;
export declare const defaultSkillContentRenderer: SkillContentRenderer;
