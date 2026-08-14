import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveInside, writeJsonAtomic } from "./safe-files.js";

export type W4PrivateRecordKind =
  | "adaptive-cache"
  | "adaptive-checkpoint"
  | "adaptive-trace"
  | "capability-snapshot"
  | "capability-task";

export interface W4PrivateRuntimeStore {
  read<T>(kind: W4PrivateRecordKind, key: string): Promise<T | undefined>;
  write<T>(kind: W4PrivateRecordKind, key: string, value: T): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function storageName(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Test-only private store. Runtime callers should bind FileProfileUserRuntimeStore. */
export class InMemoryW4PrivateRuntimeStore implements W4PrivateRuntimeStore {
  readonly #records = new Map<string, unknown>();

  async read<T>(kind: W4PrivateRecordKind, key: string): Promise<T | undefined> {
    const value = this.#records.get(`${kind}:${key}`);
    return value === undefined ? undefined : clone(value as T);
  }

  async write<T>(kind: W4PrivateRecordKind, key: string, value: T): Promise<void> {
    this.#records.set(`${kind}:${key}`, clone(value));
  }

  entries(kind?: W4PrivateRecordKind): Array<{ key: string; value: unknown }> {
    return [...this.#records.entries()]
      .filter(([key]) => kind === undefined || key.startsWith(`${kind}:`))
      .map(([key, value]) => ({ key, value: clone(value) }));
  }
}

/**
 * Stores D runtime-private state only below a Profile family's `_user` directory.
 * Keys are hashed so session/activity identifiers cannot become path components.
 */
export class FileProfileUserRuntimeStore implements W4PrivateRuntimeStore {
  readonly #root: string;

  constructor(profileFamilyRoot: string) {
    this.#root = resolveInside(resolve(profileFamilyRoot), "_user", "w4-d");
  }

  async read<T>(kind: W4PrivateRecordKind, key: string): Promise<T | undefined> {
    const path = this.#path(kind, key);
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write<T>(kind: W4PrivateRecordKind, key: string, value: T): Promise<void> {
    await writeJsonAtomic(this.#path(kind, key), value);
  }

  #path(kind: W4PrivateRecordKind, key: string): string {
    return resolveInside(this.#root, kind, `${storageName(key)}.json`);
  }
}
