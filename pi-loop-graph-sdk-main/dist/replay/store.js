import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, appendFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
export class FileRunStore {
    rootDir;
    constructor(options = {}) {
        this.rootDir = resolve(typeof options === "string" ? options : (options.rootDir ?? ".loop-graph/runs"));
    }
    location(runId) {
        return this.runDir(runId);
    }
    async appendJournal(runId, line) {
        const dir = this.runDir(runId);
        await mkdir(dir, { recursive: true });
        await appendFile(join(dir, "journal.jsonl"), line.endsWith("\n") ? line : `${line}\n`, "utf8");
    }
    readJournal(runId) {
        return readFile(join(this.runDir(runId), "journal.jsonl"), "utf8");
    }
    async writeArtifact(runId, artifactId, content, mediaType = "application/json") {
        const safeId = safeSegment(artifactId, "artifactId");
        const dir = join(this.runDir(runId), "artifacts");
        await mkdir(dir, { recursive: true });
        await atomicWrite(join(dir, safeId), content);
        return Object.freeze({
            artifactId: safeId,
            mediaType,
            byteSize: Buffer.byteLength(content, "utf8"),
            sha256: createHash("sha256").update(content).digest("hex"),
        });
    }
    readArtifact(runId, artifactId) {
        return readFile(join(this.runDir(runId), "artifacts", safeSegment(artifactId, "artifactId")), "utf8");
    }
    async writeCheckpoint(runId, checkpointId, content) {
        const dir = join(this.runDir(runId), "checkpoints");
        await mkdir(dir, { recursive: true });
        await atomicWrite(join(dir, safeSegment(checkpointId, "checkpointId")), content);
    }
    readCheckpoint(runId, checkpointId) {
        return readFile(join(this.runDir(runId), "checkpoints", safeSegment(checkpointId, "checkpointId")), "utf8");
    }
    async listCheckpoints(runId) {
        try {
            return Object.freeze((await readdir(join(this.runDir(runId), "checkpoints"), { withFileTypes: true }))
                .filter((entry) => entry.isFile())
                .map((entry) => entry.name)
                .sort());
        }
        catch (error) {
            if (error.code === "ENOENT")
                return Object.freeze([]);
            throw error;
        }
    }
    async pruneCheckpoints(runId, keep) {
        const retained = new Set(keep.map((id) => safeSegment(id, "checkpointId")));
        for (const id of await this.listCheckpoints(runId)) {
            if (!retained.has(id))
                await this.deleteCheckpoint(runId, id);
        }
    }
    async deleteCheckpoint(runId, checkpointId) {
        await rm(join(this.runDir(runId), "checkpoints", safeSegment(checkpointId, "checkpointId")), { force: true });
    }
    async writeReplay(runId, content) {
        const dir = this.runDir(runId);
        await mkdir(dir, { recursive: true });
        await atomicWrite(join(dir, "replay.json"), content);
    }
    readReplay(runId) {
        return readFile(join(this.runDir(runId), "replay.json"), "utf8");
    }
    runDir(runId) {
        return join(this.rootDir, safeSegment(runId, "runId"));
    }
}
async function atomicWrite(target, content) {
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, content, "utf8");
    try {
        await rename(temporary, target);
    }
    catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
function safeSegment(value, name) {
    if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
        throw new TypeError(`${name} contains unsafe path characters`);
    }
    return value;
}
