import type { ReplayArtifactRef } from "./events.js";
export interface JournalStore {
    appendJournal(runId: string, line: string): Promise<void>;
    readJournal(runId: string): Promise<string>;
}
export interface ArtifactStore {
    writeArtifact(runId: string, artifactId: string, content: string, mediaType?: string): Promise<ReplayArtifactRef>;
    readArtifact(runId: string, artifactId: string): Promise<string>;
}
export interface CheckpointStore {
    writeCheckpoint(runId: string, checkpointId: string, content: string): Promise<void>;
    readCheckpoint(runId: string, checkpointId: string): Promise<string>;
    listCheckpoints?(runId: string): Promise<readonly string[]>;
    pruneCheckpoints?(runId: string, keep: readonly string[]): Promise<void>;
    deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;
}
export interface RunStore extends JournalStore, ArtifactStore, CheckpointStore {
    writeReplay(runId: string, content: string): Promise<void>;
    readReplay(runId: string): Promise<string>;
    location(runId: string): string | undefined;
}
export interface FileRunStoreOptions {
    readonly rootDir?: string;
}
export declare class FileRunStore implements RunStore {
    readonly rootDir: string;
    constructor(options?: FileRunStoreOptions | string);
    location(runId: string): string;
    appendJournal(runId: string, line: string): Promise<void>;
    readJournal(runId: string): Promise<string>;
    writeArtifact(runId: string, artifactId: string, content: string, mediaType?: string): Promise<ReplayArtifactRef>;
    readArtifact(runId: string, artifactId: string): Promise<string>;
    writeCheckpoint(runId: string, checkpointId: string, content: string): Promise<void>;
    readCheckpoint(runId: string, checkpointId: string): Promise<string>;
    listCheckpoints(runId: string): Promise<readonly string[]>;
    pruneCheckpoints(runId: string, keep: readonly string[]): Promise<void>;
    deleteCheckpoint(runId: string, checkpointId: string): Promise<void>;
    writeReplay(runId: string, content: string): Promise<void>;
    readReplay(runId: string): Promise<string>;
    private runDir;
}
