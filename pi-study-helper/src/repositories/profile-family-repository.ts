import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import {
  CANONICAL_PROFILE_PATHS,
  parseProfileManifest,
  validateCanonicalProfileDirectory,
} from "../domain/profile-schema.js";
import { validateProfileV2Directory } from "../domain/profile-v2-schema.js";
import { validateRevisionSeal, type RevisionSeal } from "../domain/profile-revision-seal.js";
import type { ProfileManifestV2 } from "../domain/v2-types.js";
import type { LearningCardAsset, QuizQuestionGroupAsset } from "../contracts/index.js";
import type { Profile } from "../domain/types.js";
import type { ProfileRevisionChange, ProfileFileSnapshot } from "../domain/profile-revision.js";
import { isMutableProfileContentPath } from "../domain/profile-revision.js";
import {
  assertSafeRelativePath,
  assertSafeSubjectId,
  resolveInside,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from "../infrastructure/safe-files.js";

export interface ProfileFamilyRepositoryOptions {
  dataRoot?: string;
  fixturesRoot?: string;
  now?: () => Date;
  /** D3 fault-injection hook; production callers leave this undefined. */
  beforeV2ActivationStage?: (stage: "candidate_validated" | "active_manifest_written" | "archive_manifest_written" | "archive_prepared" | "old_archived" | "active_published") => Promise<void> | void;
}

export interface CreateDraftProfileInput {
  subjectId: string;
  name: string;
  subjectMarkdown?: string;
}

export interface ProfileRevisionCandidate {
  subjectId: string;
  name: string;
  hasActive: boolean;
  hasDraft: boolean;
  activeRevision?: number;
  draftRevision?: number;
}

export interface ActivatedRevision3Profile {
  manifest: ProfileManifestV2;
  seal: RevisionSeal;
  activation: "activated" | "reused";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const D3_FORMAL_BUNDLE_HASHES: Readonly<Record<string, string>> = {
  "act-inspect-dataframe": "bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c",
  "act-practical": "3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c",
};
const D3_ENVIRONMENT_LOCK_SHA256 = "59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43";
const D3_ENVIRONMENT_HASH = "sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76";

function canonicalizeForD3(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeForD3).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeForD3(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported formal binding value");
}

async function validateD3FormalBindings(profileRoot: string): Promise<void> {
  const lockPath = resolve(profileRoot, "environments", "environment-lock.json");
  const lockBytes = await readFile(lockPath);
  const lockHash = createHash("sha256").update(lockBytes).digest("hex");
  if (lockHash !== D3_ENVIRONMENT_LOCK_SHA256) throw new Error("D3 environment-lock.json SHA-256 binding mismatch");
  const lock = JSON.parse(lockBytes.toString("utf8")) as Record<string, unknown>;
  if (lock.environmentHash !== D3_ENVIRONMENT_HASH) throw new Error("D3 environmentHash binding mismatch");

  const bundlePath = resolve(profileRoot, "assessments", "private", "task-bundles.json");
  const fixturePath = resolve(profileRoot, "datasets", "fixtures.json");
  const bundleDocument = JSON.parse(await readFile(bundlePath, "utf8")) as Record<string, unknown>;
  const fixtureDocument = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  if (!Array.isArray(bundleDocument.bundles) || !Array.isArray(fixtureDocument.fixtures)) throw new Error("D3 formal binding document shape mismatch");
  for (const [activityId, expectedHash] of Object.entries(D3_FORMAL_BUNDLE_HASHES)) {
    const bundle = bundleDocument.bundles.find((item) => {
      const record = item as Record<string, unknown>;
      return (record.activity as Record<string, unknown> | undefined)?.activityId === activityId;
    }) as Record<string, unknown> | undefined;
    if (!bundle || typeof bundle.assetBundleHash !== "string") throw new Error(`D3 formal bundle missing: ${activityId}`);
    const { assetBundleHash, ...withoutHash } = bundle;
    const fixtureIds = ((bundle.activity as Record<string, unknown>).datasetRefs as string[] | undefined) ?? [];
    const resolvedFixtures = fixtureDocument.fixtures.filter((item) => fixtureIds.includes((item as Record<string, unknown>).fixtureId as string));
    const recomputedHash = createHash("sha256").update(canonicalizeForD3({ ...withoutHash, resolvedFixtures }), "utf8").digest("hex");
    if (assetBundleHash !== recomputedHash || recomputedHash !== expectedHash) throw new Error(`D3 formal bundle hash mismatch: ${activityId}`);
  }
}

export class ProfileFamilyRepository {
  readonly dataRoot: string;
  readonly familiesRoot: string;
  readonly fixturesRoot: string;
  private readonly now: () => Date;
  private readonly beforeV2ActivationStage?: ProfileFamilyRepositoryOptions["beforeV2ActivationStage"];

  constructor(options: ProfileFamilyRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.familiesRoot = profileFamiliesRoot(this.dataRoot);
    this.fixturesRoot = resolve(
      options.fixturesRoot ?? fileURLToPath(new URL("../../fixtures/profiles", import.meta.url)),
    );
    this.now = options.now ?? (() => new Date());
    this.beforeV2ActivationStage = options.beforeV2ActivationStage;
  }

  familyDirectory(subjectId: string): string {
    assertSafeSubjectId(subjectId);
    return resolveInside(this.familiesRoot, subjectId);
  }

  private slotDirectory(subjectId: string, slot: "active" | "draft"): string {
    return resolveInside(this.familyDirectory(subjectId), slot);
  }

  private async ensureFamilyScaffold(subjectId: string): Promise<void> {
    const family = this.familyDirectory(subjectId);
    await Promise.all([
      mkdir(resolveInside(family, "archived"), { recursive: true }),
      mkdir(resolveInside(family, "_user", "summaries", "pending"), { recursive: true }),
      mkdir(resolveInside(family, "_user", "summaries", "archived"), { recursive: true }),
    ]);
  }

  async seedDemoProfile(): Promise<Profile> {
    const subjectId = "demo-review";
    await this.ensureFamilyScaffold(subjectId);
    const active = this.slotDirectory(subjectId, "active");
    if (await pathExists(active)) {
      return validateCanonicalProfileDirectory(active, subjectId, "active");
    }
    if (await pathExists(this.slotDirectory(subjectId, "draft"))) {
      throw new Error("Cannot seed demo-review while an unconfirmed draft exists");
    }

    const fixture = resolveInside(this.fixturesRoot, subjectId);
    await validateCanonicalProfileDirectory(fixture, subjectId, "active");
    const temporary = resolveInside(this.familyDirectory(subjectId), `.active-seed-${crypto.randomUUID()}`);
    try {
      await cp(fixture, temporary, { recursive: true, errorOnExist: true });
      await validateCanonicalProfileDirectory(temporary, subjectId, "active");
      await rename(temporary, active);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return validateCanonicalProfileDirectory(active, subjectId, "active");
  }

  async listActiveProfiles(): Promise<Profile[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const families = await readdir(this.familiesRoot, { withFileTypes: true });
    const profiles: Profile[] = [];
    for (const family of families) {
      if (!family.isDirectory()) continue;
      try {
        assertSafeSubjectId(family.name);
      } catch {
        continue;
      }
      const active = this.slotDirectory(family.name, "active");
      if (await pathExists(active)) {
        profiles.push(await validateCanonicalProfileDirectory(active, family.name, "active"));
      }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async loadActiveProfile(subjectId: string): Promise<Profile> {
    return validateCanonicalProfileDirectory(this.slotDirectory(subjectId, "active"), subjectId, "active");
  }

  /** D1 read-only v2 projection. It does not alter the v1 Profile API. */
  async loadActiveProfileV2(subjectId: string): Promise<ProfileManifestV2> {
    return validateProfileV2Directory(this.slotDirectory(subjectId, "active"), "active");
  }

  async listActiveProfileV2Manifests(): Promise<ProfileManifestV2[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const manifests: ProfileManifestV2[] = [];
    for (const family of (await readdir(this.familiesRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (!family.isDirectory()) continue;
      try { manifests.push(await this.loadActiveProfileV2(family.name)); } catch { /* v1 or invalid families are not v2 bootstrap entries. */ }
    }
    return manifests;
  }

  /** Read a v2 asset without exposing the profile directory to callers. */
  async readActiveProfileV2File(subjectId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const active = this.slotDirectory(subjectId, "active");
    await validateProfileV2Directory(active, "active");
    return readFile(resolveInside(active, relativePath), "utf8");
  }

  /** Resolves the immutable revision bound to a formal session from active or archived assets only. */
  async profileV2RevisionDirectory(subjectId: string, revision: number): Promise<string> {
    assertSafeSubjectId(subjectId);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("profileRevision must be positive");
    const candidates: Array<{ directory: string; status: "active" | "archived" }> = [
      { directory: this.slotDirectory(subjectId, "active"), status: "active" },
    ];
    const archived = resolveInside(this.familyDirectory(subjectId), "archived");
    if (await pathExists(archived)) {
      const entries = await readdir(archived, { withFileTypes: true });
      for (const entry of entries) if (entry.isDirectory()) candidates.push({ directory: resolveInside(archived, entry.name), status: "archived" });
    }
    for (const candidate of candidates) {
      if (!(await pathExists(candidate.directory))) continue;
      try {
        const manifest = await validateProfileV2Directory(candidate.directory, candidate.status);
        if (manifest.subjectId === subjectId && manifest.revision === revision) return candidate.directory;
      } catch {
        // A v1 family member or invalid historical copy cannot satisfy a v2 session binding.
      }
    }
    throw new Error(`Profile v2 revision ${revision} is not available for ${subjectId}`);
  }

  async loadProfileV2Revision(subjectId: string, revision: number): Promise<ProfileManifestV2> {
    return validateProfileV2Directory(await this.profileV2RevisionDirectory(subjectId, revision));
  }

  async readProfileV2RevisionFile(subjectId: string, revision: number, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const directory = await this.profileV2RevisionDirectory(subjectId, revision);
    return readFile(resolveInside(directory, relativePath), "utf8");
  }

  async loadProfileV2RevisionCards(subjectId: string, revision: number): Promise<LearningCardAsset[]> {
    const directory = await this.profileV2RevisionDirectory(subjectId, revision);
    const manifest = await validateProfileV2Directory(directory);
    if (manifest.paths.cards === undefined) return [];
    const cardsRoot = resolveInside(directory, manifest.paths.cards);
    const entry = await stat(cardsRoot);
    const candidates: string[] = [];
    const visit = async (current: string): Promise<void> => {
      for (const child of await readdir(current, { withFileTypes: true })) {
        const absolute = resolveInside(current, child.name);
        if (child.isDirectory()) await visit(absolute);
        else if (child.isFile() && child.name.endsWith(".json")) candidates.push(absolute);
      }
    };
    if (entry.isFile()) candidates.push(cardsRoot); else await visit(cardsRoot);
    for (const path of candidates.sort((left, right) => left.localeCompare(right, "en"))) {
      const parsed = JSON.parse(await readFile(path, "utf8")) as { cards?: LearningCardAsset[] };
      if (Array.isArray(parsed.cards)) return structuredClone(parsed.cards);
    }
    return [];
  }

  async loadProfileV2RevisionQuizGroups(subjectId: string, revision: number): Promise<QuizQuestionGroupAsset> {
    const directory = await this.profileV2RevisionDirectory(subjectId, revision);
    const manifest = await validateProfileV2Directory(directory);
    if (manifest.paths.assessments === undefined) return { groups: [] };
    const assessmentsRoot = resolveInside(directory, manifest.paths.assessments);
    const groups: QuizQuestionGroupAsset["groups"] = [];
    const visit = async (current: string): Promise<void> => {
      for (const child of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        if (child.name === "private") continue;
        const absolute = resolveInside(current, child.name);
        if (child.isDirectory()) await visit(absolute);
        else if (child.isFile() && child.name.endsWith(".json")) {
          const value = JSON.parse(await readFile(absolute, "utf8")) as { groups?: unknown[] };
          if (!Array.isArray(value.groups)) continue;
          for (const group of value.groups) {
            if (typeof group === "object" && group !== null && Array.isArray((group as { questions?: unknown }).questions)) {
              groups.push(structuredClone(group) as QuizQuestionGroupAsset["groups"][number]);
            }
          }
        }
      }
    };
    await visit(assessmentsRoot);
    return { groups };
  }

  async loadDraftProfile(subjectId: string): Promise<Profile> {
    return validateCanonicalProfileDirectory(this.slotDirectory(subjectId, "draft"), subjectId, "draft");
  }

  /**
   * D3-only v2 activation. The candidate is read from the immutable fixture
   * slot, while runtime state is published under the user's Profile family.
   * No caller may mutate status or move active directories by hand.
   */
  async activateV2Draft(subjectId: string): Promise<ProfileManifestV2> {
    assertSafeSubjectId(subjectId);
    if (await pathExists(resolveInside(this.fixturesRoot, "pandas-cleaning-revision-3-draft"))) {
      return (await this.activateRevision3Draft(subjectId)).manifest;
    }
    const candidate = resolveInside(this.fixturesRoot, "pandas-cleaning-v2-draft");
    const family = this.familyDirectory(subjectId);
    const active = resolveInside(family, "active");
    const archivedRoot = resolveInside(family, "archived");
    await mkdir(archivedRoot, { recursive: true });

    const candidateManifest = await validateProfileV2Directory(candidate, "draft");
    if (candidateManifest.subjectId !== subjectId || candidateManifest.revision !== 2 || candidateManifest.revisionOf !== 1) {
      throw new Error("D3 Profile candidate must be pandas-cleaning revision 2 revisionOf=1");
    }
    await validateD3FormalBindings(candidate);
    await this.beforeV2ActivationStage?.("candidate_validated");

    const activeExists = await pathExists(active);
    let oldManifest: ProfileManifestV2 | undefined;
    if (activeExists) {
      oldManifest = await validateProfileV2Directory(active, "active");
      if (oldManifest.subjectId !== subjectId || oldManifest.revision >= candidateManifest.revision) {
        throw new Error("Existing active Profile is not an older revision of the candidate");
      }
    }

    const token = crypto.randomUUID();
    const prepared = resolveInside(family, `.v2-activation-${token}`);
    const archivePrepared = resolveInside(family, `.v2-archive-${token}`);
    const oldBackup = resolveInside(family, `.v2-old-${token}`);
    const archiveName = `${timestampForPath(this.now())}-${token.slice(0, 8)}`;
    const archiveTarget = resolveInside(archivedRoot, archiveName);
    let oldMoved = false;
    let newPublished = false;
    try {
      await cp(candidate, prepared, { recursive: true, errorOnExist: true });
      const activated = { ...candidateManifest, status: "active" as const };
      await writeJsonAtomic(resolve(prepared, "profile.json"), activated);
      await this.beforeV2ActivationStage?.("active_manifest_written");
      await validateProfileV2Directory(prepared, "active");

      if (oldManifest !== undefined) {
        await cp(active, archivePrepared, { recursive: true, errorOnExist: true });
        await writeJsonAtomic(resolve(archivePrepared, "profile.json"), { ...oldManifest, status: "archived" as const });
        await this.beforeV2ActivationStage?.("archive_manifest_written");
        await validateProfileV2Directory(archivePrepared, "archived");
      }
      await this.beforeV2ActivationStage?.("archive_prepared");

      if (oldManifest !== undefined) {
        await rename(active, oldBackup);
        await rename(archivePrepared, archiveTarget);
        oldMoved = true;
        await this.beforeV2ActivationStage?.("old_archived");
      }
      await rename(prepared, active);
      newPublished = true;
      await this.beforeV2ActivationStage?.("active_published");
      await rm(archivePrepared, { recursive: true, force: true });
      await rm(oldBackup, { recursive: true, force: true });
      return validateProfileV2Directory(active, "active");
    } catch (error) {
      if (newPublished && await pathExists(active)) await rm(active, { recursive: true, force: true });
      if (oldMoved && await pathExists(oldBackup) && !(await pathExists(active))) await rename(oldBackup, active);
      await rm(prepared, { recursive: true, force: true });
      await rm(archivePrepared, { recursive: true, force: true });
      await rm(oldBackup, { recursive: true, force: true });
      await rm(archiveTarget, { recursive: true, force: true });
      throw error;
    }
  }

  /** W4 strict activation. It never auto-migrates an existing active revision. */
  async activateRevision3Draft(subjectId: string): Promise<ActivatedRevision3Profile> {
    assertSafeSubjectId(subjectId);
    const candidate = resolveInside(this.fixturesRoot, "pandas-cleaning-revision-3-draft");
    const manifest = await validateProfileV2Directory(candidate, "draft");
    if (manifest.subjectId !== subjectId || manifest.revision !== 3 || manifest.revisionOf !== 2) {
      throw new Error("W4 Profile candidate must be pandas-cleaning revision 3 revisionOf=2");
    }
    const candidateSeal = await validateRevisionSeal(candidate, subjectId);
    await this.beforeV2ActivationStage?.("candidate_validated");

    const family = this.familyDirectory(subjectId);
    const active = resolveInside(family, "active");
    await mkdir(resolveInside(family, "archived"), { recursive: true });
    if (await pathExists(active)) {
      const activeManifest = await validateProfileV2Directory(active, "active");
      if (activeManifest.revision !== 3) {
        throw new Error("Existing active Profile requires owner-approved migration before revision 3 activation");
      }
      const activeSeal = await validateRevisionSeal(active, subjectId);
      if (activeSeal.assetTreeSha256 !== candidateSeal.assetTreeSha256) {
        throw new Error("Existing active revision 3 has a different seal and cannot be auto-migrated");
      }
      return { manifest: activeManifest, seal: activeSeal, activation: "reused" };
    }

    const token = crypto.randomUUID();
    const prepared = resolveInside(family, `.revision-3-activation-${token}`);
    let published = false;
    try {
      await cp(candidate, prepared, { recursive: true, errorOnExist: true });
      await writeJsonAtomic(resolve(prepared, "profile.json"), { ...manifest, status: "active" as const });
      await this.beforeV2ActivationStage?.("active_manifest_written");
      await validateProfileV2Directory(prepared, "active");
      const preparedSeal = await validateRevisionSeal(prepared, subjectId);
      if (preparedSeal.assetTreeSha256 !== candidateSeal.assetTreeSha256) throw new Error("Prepared revision 3 seal changed during activation");
      await rename(prepared, active);
      published = true;
      await this.beforeV2ActivationStage?.("active_published");
      const activeManifest = await validateProfileV2Directory(active, "active");
      const activeSeal = await validateRevisionSeal(active, subjectId);
      if (activeSeal.assetTreeSha256 !== candidateSeal.assetTreeSha256) throw new Error("Published revision 3 seal changed during activation");
      return { manifest: activeManifest, seal: activeSeal, activation: "activated" };
    } catch (error) {
      if (published && await pathExists(active)) await rm(active, { recursive: true, force: true });
      await rm(prepared, { recursive: true, force: true });
      throw error;
    }
  }

  async listRevisionCandidates(): Promise<ProfileRevisionCandidate[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const families = await readdir(this.familiesRoot, { withFileTypes: true });
    const candidates: ProfileRevisionCandidate[] = [];
    for (const family of families) {
      if (!family.isDirectory()) continue;
      try {
        assertSafeSubjectId(family.name);
      } catch {
        continue;
      }
      let active: Profile | undefined;
      let draft: Profile | undefined;
      try { active = await this.loadActiveProfile(family.name); } catch { /* candidate may be draft-only */ }
      try { draft = await this.loadDraftProfile(family.name); } catch { /* candidate may be active-only */ }
      if (!active && !draft) continue;
      candidates.push({
        subjectId: family.name,
        name: draft?.name ?? active!.name,
        hasActive: active !== undefined,
        hasDraft: draft !== undefined,
        activeRevision: active?.revision,
        draftRevision: draft?.revision,
      });
    }
    return candidates.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  /** active 只读出口；代码节点可读取资料，但仓库不提供 active 写入能力。 */
  async readActiveFile(subjectId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const active = this.slotDirectory(subjectId, "active");
    await this.loadActiveProfile(subjectId);
    return readFile(resolveInside(active, relativePath), "utf8");
  }

  async createDraftProfile(input: CreateDraftProfileInput): Promise<Profile> {
    assertSafeSubjectId(input.subjectId);
    if (input.name.trim() === "") throw new Error("Profile name must not be empty");
    await this.ensureFamilyScaffold(input.subjectId);
    const draft = this.slotDirectory(input.subjectId, "draft");
    if (await pathExists(draft)) throw new Error(`Draft already exists for ${input.subjectId}`);
    if (await pathExists(this.slotDirectory(input.subjectId, "active"))) {
      throw new Error(`Active Profile already exists for ${input.subjectId}; create a revision draft instead`);
    }

    const temporary = resolveInside(this.familyDirectory(input.subjectId), `.draft-create-${crypto.randomUUID()}`);
    const date = this.now();
    const manifest: Profile = {
      subjectId: input.subjectId,
      name: input.name.trim(),
      status: "draft",
      slot: "draft",
      version: timestampForPath(date),
      revision: 1,
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      paths: { ...CANONICAL_PROFILE_PATHS },
    };
    try {
      await Promise.all([
        mkdir(resolve(temporary, "cards"), { recursive: true }),
        mkdir(resolve(temporary, "chapters"), { recursive: true }),
        mkdir(resolve(temporary, "exam_points"), { recursive: true }),
      ]);
      await Promise.all([
        writeJsonAtomic(resolve(temporary, "profile.json"), manifest),
        writeTextAtomic(resolve(temporary, "subject.md"), input.subjectMarkdown ?? `# ${manifest.name}\n`),
        writeJsonAtomic(resolve(temporary, "knowledge_index.json"), { subject: manifest.name, chapters: {} }),
        writeJsonAtomic(resolve(temporary, "source_map.json"), { sources: [], mappings: {}, unmapped_sources: [], uncertain_mappings: {} }),
        writeTextAtomic(resolve(temporary, "quality_report.md"), `# ${manifest.name} 质量报告\n\n尚未生成资料内容。\n`),
      ]);
      await validateCanonicalProfileDirectory(temporary, input.subjectId, "draft");
      await rename(temporary, draft);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return this.loadDraftProfile(input.subjectId);
  }

  async createRevisionDraft(subjectId: string): Promise<Profile> {
    await this.ensureFamilyScaffold(subjectId);
    const draft = this.slotDirectory(subjectId, "draft");
    if (await pathExists(draft)) throw new Error(`Draft already exists for ${subjectId}`);
    const active = this.slotDirectory(subjectId, "active");
    const current = await validateCanonicalProfileDirectory(active, subjectId, "active");
    const temporary = resolveInside(this.familyDirectory(subjectId), `.draft-copy-${crypto.randomUUID()}`);
    try {
      await cp(active, temporary, { recursive: true, errorOnExist: true });
      const date = this.now();
      const revision: Profile = {
        ...current,
        status: "draft",
        slot: "draft",
        version: timestampForPath(date),
        revision: current.revision + 1,
        revisionOf: current.version,
        updatedAt: date.toISOString(),
        paths: { ...current.paths },
      };
      await writeJsonAtomic(resolve(temporary, "profile.json"), revision);
      await validateCanonicalProfileDirectory(temporary, subjectId, "draft");
      await rename(temporary, draft);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return this.loadDraftProfile(subjectId);
  }

  async writeDraftFile(subjectId: string, relativePath: string, content: string): Promise<void> {
    assertSafeRelativePath(relativePath);
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    const normalized = relativePath.replaceAll("\\", "/");
    if (normalized === "profile.json") {
      parseProfileManifest(content, subjectId, "draft");
    }
    const target = resolveInside(draft, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeTextAtomic(target, content);
  }

  async readDraftFile(subjectId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    return readFile(resolveInside(draft, relativePath), "utf8");
  }

  async listDraftFiles(subjectId: string): Promise<ProfileFileSnapshot[]> {
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    const files: ProfileFileSnapshot[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Profile draft: ${entry.name}`);
        const absolute = resolveInside(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && /\.(md|json)$/iu.test(entry.name)) {
          const relativePath = relative(draft, absolute).replaceAll("\\", "/");
          assertSafeRelativePath(relativePath);
          files.push({ path: relativePath, content: await readFile(absolute, "utf8") });
        }
      }
    };
    await visit(draft);
    return files;
  }

  async listActiveFiles(subjectId: string): Promise<ProfileFileSnapshot[]> {
    const active = this.slotDirectory(subjectId, "active");
    await this.loadActiveProfile(subjectId);
    const files: ProfileFileSnapshot[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in active Profile: ${entry.name}`);
        const absolute = resolveInside(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && /\.(md|json)$/iu.test(entry.name)) {
          const relativePath = relative(active, absolute).replaceAll("\\", "/");
          assertSafeRelativePath(relativePath);
          files.push({ path: relativePath, content: await readFile(absolute, "utf8") });
        }
      }
    };
    await visit(active);
    return files;
  }

  async applyDraftChanges(subjectId: string, changes: readonly ProfileRevisionChange[]): Promise<Profile> {
    if (changes.length === 0) throw new Error("Profile revision requires at least one change");
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    await this.listDraftFiles(subjectId);
    const seen = new Set<string>();
    for (const change of changes) {
      const path = change.path.replaceAll("\\", "/");
      assertSafeRelativePath(path);
      if (!isMutableProfileContentPath(path) && path !== "quality_report.md") {
        throw new Error(`Profile revision path is not writable: ${path}`);
      }
      if (change.operation === "delete" && ["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"].includes(path)) {
        throw new Error(`Required Profile file cannot be deleted: ${path}`);
      }
      if (seen.has(path)) throw new Error(`Duplicate Profile revision path: ${path}`);
      seen.add(path);
      if (change.operation !== "delete" && typeof change.content !== "string") {
        throw new Error(`Profile revision content is required: ${path}`);
      }
    }

    const family = this.familyDirectory(subjectId);
    const temporary = resolveInside(family, `.draft-update-${crypto.randomUUID()}`);
    const backup = resolveInside(family, `.draft-backup-${crypto.randomUUID()}`);
    try {
      await cp(draft, temporary, { recursive: true, errorOnExist: true });
      for (const change of changes) {
        const target = resolveInside(temporary, change.path);
        if (change.operation === "delete") await rm(target, { force: true });
        else await writeTextAtomic(target, change.content!);
      }
      const manifest = parseProfileManifest(await readFile(resolve(temporary, "profile.json"), "utf8"), subjectId, "draft");
      await writeJsonAtomic(resolve(temporary, "profile.json"), {
        ...manifest,
        updatedAt: this.now().toISOString(),
      });
      await validateCanonicalProfileDirectory(temporary, subjectId, "draft");
      await rename(draft, backup);
      try {
        await rename(temporary, draft);
      } catch (error) {
        await rename(backup, draft);
        throw error;
      }
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
      return this.loadDraftProfile(subjectId);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (await pathExists(backup)) {
        if (!(await pathExists(draft))) await rename(backup, draft);
        else await rm(backup, { recursive: true, force: true });
      }
      throw error;
    }
  }

  private async nextArchiveDirectory(subjectId: string): Promise<string> {
    const archived = resolveInside(this.familyDirectory(subjectId), "archived");
    await mkdir(archived, { recursive: true });
    const base = timestampForPath(this.now());
    for (let suffix = 0; ; suffix += 1) {
      const name = suffix === 0 ? base : `${base}-${suffix}`;
      const candidate = resolveInside(archived, name);
      if (!(await pathExists(candidate))) return candidate;
    }
  }

  async enableDraft(subjectId: string): Promise<Profile> {
    const draft = this.slotDirectory(subjectId, "draft");
    const active = this.slotDirectory(subjectId, "active");
    const currentDraft = await validateCanonicalProfileDirectory(draft, subjectId, "draft");
    await this.listDraftFiles(subjectId);
    const activeExists = await pathExists(active);
    let currentActive: Profile | undefined;
    if (activeExists) currentActive = await validateCanonicalProfileDirectory(active, subjectId, "active");
    if (currentDraft.revisionOf !== undefined) {
      if (!currentActive) throw new Error("Revision draft cannot be enabled because its active source is missing");
      if (currentDraft.revisionOf !== currentActive.version) {
        throw new Error(`Revision draft is stale: expected active ${currentDraft.revisionOf}, found ${currentActive.version}`);
      }
    } else if (currentActive) {
      throw new Error("A new Profile draft cannot replace an existing active Profile without revisionOf");
    }

    const date = this.now();
    const activated: Profile = {
      ...currentDraft,
      status: "active",
      slot: "active",
      updatedAt: date.toISOString(),
      paths: { ...currentDraft.paths },
    };
    const family = this.familyDirectory(subjectId);
    const prepared = resolveInside(family, `.active-enable-${crypto.randomUUID()}`);
    const draftBackup = resolveInside(family, `.draft-enable-backup-${crypto.randomUUID()}`);
    let archive: string | undefined;
    try {
      await cp(draft, prepared, { recursive: true, errorOnExist: true });
      await writeJsonAtomic(resolve(prepared, "profile.json"), activated);
      await validateCanonicalProfileDirectory(prepared, subjectId, "active");
      if (currentActive) {
        archive = await this.nextArchiveDirectory(subjectId);
        await rename(active, archive);
      }
      await rename(draft, draftBackup);
      try {
        await rename(prepared, active);
      } catch (error) {
        await rename(draftBackup, draft);
        if (archive !== undefined && !(await pathExists(active)) && (await pathExists(archive))) {
          await rename(archive, active);
        }
        throw error;
      }
      await rm(draftBackup, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      await rm(prepared, { recursive: true, force: true });
      if (await pathExists(draftBackup) && !(await pathExists(draft))) await rename(draftBackup, draft);
      if (archive !== undefined && !(await pathExists(active)) && (await pathExists(archive))) {
        await rename(archive, active);
      }
      throw error;
    }
    return validateCanonicalProfileDirectory(active, subjectId, "active");
  }

  async discardDraft(subjectId: string): Promise<void> {
    const draft = this.slotDirectory(subjectId, "draft");
    if (!(await pathExists(draft))) throw new Error(`No draft exists for ${subjectId}`);
    await rm(draft, { recursive: true });
  }
}
