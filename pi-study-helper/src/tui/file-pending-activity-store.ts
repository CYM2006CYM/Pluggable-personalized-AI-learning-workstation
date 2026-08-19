import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePendingActivity, type PendingActivityStore } from "./shared-session.js";

const PENDING_DIRECTORY = "tui";
const PENDING_FILE = "pending-activity.json";

export class FilePendingActivityStore implements PendingActivityStore {
  private readonly directory: string;
  private readonly path: string;

  constructor(dataRoot: string) {
    this.directory = resolve(dataRoot, PENDING_DIRECTORY);
    this.path = resolve(this.directory, PENDING_FILE);
  }

  load(): string | undefined {
    try {
      return readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  save(value: string): void {
    const safeValue = JSON.stringify(parsePendingActivity(value));
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(this.path, safeValue, "utf8");
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
