export interface IncompleteNodeMessageInput {
    nodeId: string;
    completeToolName: "__graph_complete__";
}
export interface DeadRunMessageInput {
    nodeId: string | null;
}
export interface GraphFailureMessageInput {
    graphId: string;
    reason: string;
}
export interface ModelMessageFormatter {
    incompleteNode(input: IncompleteNodeMessageInput): string;
    deadRun(input: DeadRunMessageInput): string;
    graphFailure(input: GraphFailureMessageInput): string;
}
export declare const defaultModelMessageFormatter: ModelMessageFormatter;
