/**
 * Git-backed skill and extension repositories.
 *
 * This is deliberately separate from git.ts: that module serves read-only file
 * browser requests confined to a workspace root. This service starts only from
 * runtime/configuration paths the server already trusts and exposes opaque ids.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  AgentCollectionSkill,
  AgentResourceCollection,
  AgentResourceRemoval,
  AgentResourceInfo,
  AgentResourceInventory,
  AgentResourceKind,
  AgentResourceRepository,
  AgentResourceRepositoryAssessment,
  AgentResourceRepositoryPreview,
  AgentResourceRepositoryStatus,
  AgentSkillCatalogueBound,
  AgentSkillCatalogueEntry,
} from "@pi-outpost/shared";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { currentGitExecutable } from "./git.ts";
import { type SkillCollection, userConfigDir } from "./config.ts";
import { isWithin } from "./sandbox.ts";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Git must never be able to ask a human anything here. A private address would
 * otherwise turn a refresh into a process sitting on a prompt until the timeout —
 * and git opens /dev/tty directly, so piping stdio is not enough to stop it. When
 * the server was started from a terminal, that prompt takes the operator's terminal.
 *
 * `GIT_TERMINAL_PROMPT=0` closes the tty path and empty askpass variables prevent
 * Git from launching a prompt helper. Authentication the deployment already configured is untouched:
 * a credential helper that answers without prompting, an ssh agent, or a key with
 * no passphrase all still work. An operator's own `GIT_SSH_COMMAND` is left alone —
 * only its absence is filled in, and only with the batch flag.
 */
function nonInteractiveEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    GCM_INTERACTIVE: "Never",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
  };
}

const MAX_BUFFER = 2 * 1024 * 1024;
const REFRESH_CONCURRENCY = 4;
const PREVIEW_TTL_MS = 10 * 60_000;
const ASSESSMENT_TTL_MS = 5 * 60_000;
const repositoryLocks = new Map<string, Promise<void>>();
const repositoryIdentities = new Map<string, { filesystemIdentity: string; id: string }>();
type ResourceGitObserver = (event: {
  phase: "start" | "end";
  cwd: string;
  args: readonly string[];
  env: Readonly<NodeJS.ProcessEnv>;
}) => void;
let resourceGitObserver: ResourceGitObserver | undefined;

/**
 * Git marks its object files read-only, and on Windows a read-only file cannot be
 * unlinked, so the first `rm` of a clone there fails with EPERM. Clearing the
 * read-only bits (never following a link) and trying once more is what makes
 * removal work on that platform; anything still failing is reported.
 */
async function removeTreeForcefully(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    await makeWritable(target);
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function makeWritable(target: string): Promise<void> {
  const entry = await fs.lstat(target).catch(() => undefined);
  if (!entry || entry.isSymbolicLink()) return;
  if (entry.isDirectory()) {
    await fs.chmod(target, 0o700).catch(() => undefined);
    const children = await fs.readdir(target).catch(() => [] as string[]);
    for (const child of children) await makeWritable(path.join(target, child));
  } else {
    await fs.chmod(target, 0o600).catch(() => undefined);
  }
}

let resourceRemover: (target: string) => Promise<void> = removeTreeForcefully;

/** Test seam: make deletion fail on demand, which no portable fixture can force. */
export function useResourceRemover(remover?: (target: string) => Promise<void>): void {
  resourceRemover = remover ?? removeTreeForcefully;
}

/** Test seam for proving command shape and concurrency without replacing Git. */
export function useResourceGitObserver(observer?: ResourceGitObserver): void {
  resourceGitObserver = observer;
}

interface KnownRepository {
  id: string;
  path: string;
  filesystemIdentity: string;
  name: string;
  resources: AgentResourceInfo[];
  containsExtensions: boolean;
  assessment: AgentResourceRepositoryAssessment;
  collection?: AgentResourceCollection;
  removal: AgentResourceRemoval;
}

interface PreviewRecord {
  preview: AgentResourceRepositoryPreview;
  rootsKey: string;
  expiresAt: number;
  /** pi-outpost created this clone, or it lies in managed storage. */
  managed: boolean;
}

export interface ConfirmedEnrollment {
  repositoryPath: string;
  mode: AgentResourceRepositoryPreview["mode"];
  managed: boolean;
  skillRoots: string[];
  extensionRoots: string[];
  enabledSkills: string[];
}

interface AssessmentRecord {
  repositoryId: string;
  branch: string;
  upstream: string;
  localRevision: string;
  upstreamRevision: string;
  expiresAt: number;
}

export interface ResourceInventoryInput {
  resources: AgentResourceInfo[];
  capabilities: AgentResourceInventory["capabilities"];
  configuredSkillPaths: string[];
  userSkillPaths: string[];
  configuredExtensionPaths: string[];
  userExtensionPaths: string[];
  userSkillCollections?: readonly SkillCollection[];
  extensionLock: boolean;
}

export interface ResourceUpdateOutcome {
  status: "updated" | "refused";
  repositoryId: string;
  beforeRevision?: string;
  afterRevision?: string;
  submodulesUpdated?: false;
  reason?: string;
  assessment?: AgentResourceRepositoryAssessment;
}

export interface ResourceUpdateOptions {
  allowExecutableChanges?: boolean;
  extensionLock: boolean;
  localRevision: string;
  upstreamRevision: string;
  /** Runs under the repository mutex, immediately before Git integration. */
  guard?: () => Promise<string | undefined>;
}

export class ResourceRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceRepositoryError";
  }
}

export class ResourceRepositoryService {
  private repositories = new Map<string, KnownRepository>();
  private previews = new Map<string, PreviewRecord>();
  private assessments = new Map<string, AssessmentRecord>();
  private issuedAssessmentTokens = new Map<string, number>();
  private readonly hooksDir = path.join(os.tmpdir(), `pi-outpost-empty-hooks-${process.pid}`);

  constructor(
    private readonly managedRoot = path.join(userConfigDir(), "resource-repositories"),
    private readonly now: () => number = Date.now,
  ) {}

  async buildInventory(input: ResourceInventoryInput): Promise<AgentResourceInventory> {
    const declared = [
      ...input.configuredSkillPaths.map((value) => ({ kind: "skill" as const, path: value, origin: "configured" as const })),
      ...input.userSkillPaths.map((value) => ({ kind: "skill" as const, path: value, origin: "user" as const })),
      ...input.configuredExtensionPaths.map((value) => ({ kind: "extension" as const, path: value, origin: "configured" as const })),
      ...input.userExtensionPaths.map((value) => ({ kind: "extension" as const, path: value, origin: "user" as const })),
    ];
    const resources = await normalizeResources(input.resources, declared);
    const byRoot = new Map<string, AgentResourceInfo[]>();

    for (const resource of resources) {
      if (!resource.path) continue;
      const root = await enclosingRepository(resource.path);
      if (!root) {
        resource.unavailableReason ??= "Not backed by a Git repository";
        continue;
      }
      const list = byRoot.get(root) ?? [];
      list.push(resource);
      byRoot.set(root, list);
    }

    // A collection is a repository even when none of its skills is loaded: its
    // catalogue is what the user turns skills on from. One whose folder vanished
    // stays listed, so it can still be seen and removed.
    const collectionsByRoot = new Map<string, SkillCollection>();
    const missingCollections: SkillCollection[] = [];
    for (const collection of input.userSkillCollections ?? []) {
      const canonical = await canonicalExisting(collection.path);
      const root = canonical ? await enclosingRepository(canonical) : undefined;
      if (!root) {
        missingCollections.push(collection);
        continue;
      }
      collectionsByRoot.set(root, collection);
      if (!byRoot.has(root)) byRoot.set(root, []);
    }
    const removalFor = await removalPolicy(input, await canonicalExisting(this.managedRoot));
    const loadedSkills = resources.filter((resource) => resource.kind === "skill" && resource.path);

    const next = new Map<string, KnownRepository>();
    for (const [root, repoResources] of byRoot) {
      const filesystemIdentity = await repositoryFilesystemIdentity(root);
      const id = repositoryId(root, filesystemIdentity);
      const containsExtensions = repoResources.some((resource) => resource.kind === "extension");
      const previous = this.repositories.get(id);
      const assessment =
        input.extensionLock && containsExtensions
          ? blockedAssessment(id, "locked", "Extension updates are locked by this deployment")
          : previous?.assessment.status === "locked"
            ? blockedAssessment(id, "unchecked")
            : previous?.assessment ?? blockedAssessment(id, "unchecked");
      const collection = collectionsByRoot.get(root);
      const name = await repositoryDisplayName(root);
      next.set(id, {
        id,
        path: root,
        filesystemIdentity,
        name,
        resources: repoResources,
        containsExtensions,
        assessment,
        ...(collection ? { collection: await collectionView(root, name, collection, loadedSkills) } : {}),
        removal: removalFor(root, collection),
      });
    }
    for (const collection of missingCollections) {
      const where = path.resolve(collection.path);
      const filesystemIdentity = `missing:${where}`;
      const id = repositoryId(where, filesystemIdentity);
      const name = path.basename(where) || where;
      next.set(id, {
        id,
        path: where,
        filesystemIdentity,
        name,
        resources: [],
        containsExtensions: false,
        assessment: blockedAssessment(id, "unavailable", "The repository's folder no longer exists"),
        collection: withGroups(name, collection.enabledSkills.map(missingSkill)),
        removal: { allowed: true, deletesFiles: false, path: where },
      });
    }
    this.repositories = next;
    const groupedIds = new Set([...next.values()].flatMap((repo) => repo.resources.map((resource) => resource.id)));
    this.lastUngrouped = resources.filter((resource) => !groupedIds.has(resource.id));
    return this.inventory(input.capabilities);
  }

  inventory(capabilities: AgentResourceInventory["capabilities"]): AgentResourceInventory {
    const resources = [...this.repositories.values()].flatMap((repo) => repo.resources);
    const knownIds = new Set(resources.map((resource) => resource.id));
    // Resources outside Git remain attached by buildInventory through this field.
    for (const resource of this.lastUngrouped) if (!knownIds.has(resource.id)) resources.push(resource);
    return {
      resources: resources.sort(resourceSort),
      repositories: [...this.repositories.values()]
        .map(toWireRepository)
        .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
      capabilities,
    };
  }

  private lastUngrouped: AgentResourceInfo[] = [];

  async rebuildInventory(input: ResourceInventoryInput): Promise<AgentResourceInventory> {
    return this.buildInventory(input);
  }

  /**
   * A worktree already registered through one of the user's skill roots keeps that
   * load-everything enrollment ("roots"); every other repository is enrolled as a
   * collection whose skills start off.
   */
  async preview(
    selectedPath: string,
    extensionLock: boolean,
    options: { userSkillPaths?: readonly string[]; managed?: boolean } = {},
  ): Promise<AgentResourceRepositoryPreview> {
    const selected = await canonicalDirectory(selectedPath);
    const root = await enclosingRepository(selected);
    if (!root) throw new ResourceRepositoryError("The selected directory is not inside a Git worktree");
    const mode = (await enrolledThroughSkillRoots(root, options.userSkillPaths ?? [])) ? "roots" : "collection";
    const observed = await observeRepository(root, extensionLock, mode);
    if (observed.roots.length === 0 && observed.skills.length === 0) {
      throw new ResourceRepositoryError("No recognizable skill or extension roots were found in this repository");
    }
    const headRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const token = randomUUID();
    const preview: AgentResourceRepositoryPreview = {
      token,
      repositoryPath: root,
      repositoryName: await repositoryDisplayName(root),
      headRevision,
      mode,
      roots: observed.roots,
      skills: observed.skills,
      ...(observed.bound ? { bound: observed.bound } : {}),
    };
    const managedRoot = await canonicalExisting(this.managedRoot);
    this.previews.set(token, {
      preview,
      rootsKey: observed.key,
      expiresAt: this.now() + PREVIEW_TTL_MS,
      managed: options.managed === true || (managedRoot !== undefined && managedRoot !== root && isWithin(managedRoot, root)),
    });
    return preview;
  }

  suggestedClonePath(repositoryUrl: string): string {
    const address = validateRepositoryAddress(repositoryUrl);
    const identity = repositoryAddressIdentity(address);
    const slug = repositorySlug(identity);
    return path.join(
      this.managedRoot,
      `${slug}-${createHash("sha256").update(identity).digest("hex").slice(0, 10)}`,
    );
  }

  async cloneAndPreview(
    repositoryUrl: string,
    destinationPath: string,
    extensionLock: boolean,
    userSkillPaths: readonly string[] = [],
  ): Promise<AgentResourceRepositoryPreview> {
    const address = validateRepositoryAddress(repositoryUrl);
    const identity = repositoryAddressIdentity(address);
    await fs.mkdir(this.managedRoot, { recursive: true });
    const destination = await canonicalCloneDestination(destinationPath);
    let existing = false;
    try {
      const entry = await fs.lstat(destination);
      if (entry.isSymbolicLink()) throw new ResourceRepositoryError("The local folder cannot be a symbolic link");
      if (!entry.isDirectory()) throw new ResourceRepositoryError("The local folder is occupied by existing content");
      existing = true;
    } catch (error) {
      if (error instanceof ResourceRepositoryError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing) {
      const topLevel = await tryGit(destination, ["rev-parse", "--show-toplevel"]);
      const canonicalTopLevel = topLevel ? await canonicalExisting(topLevel) : undefined;
      if (canonicalTopLevel !== destination) {
        throw new ResourceRepositoryError("The managed clone destination must be the repository's top-level folder");
      }
      const origin = await tryGit(destination, ["remote", "get-url", "origin"]);
      if (!origin || repositoryAddressIdentity(origin) !== identity) {
        throw new ResourceRepositoryError("The managed clone destination is occupied by a different repository");
      }
    } else {
      await fs.mkdir(this.hooksDir, { recursive: true });
      try {
        await runGit(this.managedRoot, [
          "-c",
          `core.hooksPath=${this.hooksDir}`,
          "clone",
          "--no-recurse-submodules",
          "--origin",
          "origin",
          "--",
          address,
          destination,
        ]);
      } catch (error) {
        throw new ResourceRepositoryError(`Could not clone ${redactRepositoryAddress(address)}: ${redactSecrets(firstLine(error))}`);
      }
    }
    const credentialFreeAddress = repositoryAddressWithoutCredentials(address);
    if (credentialFreeAddress !== address) await runGit(destination, ["remote", "set-url", "origin", credentialFreeAddress]);
    // Only a folder this clone created is pi-outpost's to delete later; a reused
    // existing clone may be someone's working copy (unless it sits in managed storage).
    const preview = await this.preview(destination, extensionLock, { userSkillPaths, managed: !existing });
    preview.repositoryUrl = redactRepositoryAddress(address);
    const record = this.previews.get(preview.token);
    if (record) record.preview = preview;
    return preview;
  }

  async confirmPreview(
    token: string,
    skillRoots: string[],
    extensionRoots: string[],
    extensionLock: boolean,
    enabledSkills: string[] = [],
  ): Promise<ConfirmedEnrollment> {
    const record = this.previews.get(token);
    this.previews.delete(token);
    if (!record) throw new ResourceRepositoryError("This repository preview is no longer valid; preview it again");
    if (this.now() > record.expiresAt) throw new ResourceRepositoryError("This repository preview has expired; preview it again");
    const { preview } = record;
    const fresh = await observeRepository(preview.repositoryPath, extensionLock, preview.mode);
    const head = (await runGit(preview.repositoryPath, ["rev-parse", "HEAD"])).trim();
    if (head !== preview.headRevision || fresh.key !== record.rootsKey) {
      throw new ResourceRepositoryError("The repository changed after preview; preview it again");
    }
    const permitted = new Map(fresh.roots.map((root) => [`${root.kind}:${root.path}`, root]));
    const select = (kind: AgentResourceKind, values: string[]) =>
      [...new Set(values)].map((value) => {
        const candidate = permitted.get(`${kind}:${value}`);
        if (!candidate || candidate.locked) throw new ResourceRepositoryError(`The selected ${kind} root is unavailable`);
        return candidate.path;
      });
    // In a collection preview `fresh.roots` holds no skill root, so a skill root sent
    // for one is refused here as unavailable: its skills are chosen one by one.
    const skills = select("skill", skillRoots);
    const extensions = select("extension", extensionRoots);
    const base = { repositoryPath: preview.repositoryPath, managed: record.managed, extensionRoots: extensions };
    if (preview.mode === "roots") {
      if (enabledSkills.length > 0) {
        throw new ResourceRepositoryError("This repository is registered through skill roots; select roots rather than individual skills");
      }
      if (skills.length + extensions.length === 0) throw new ResourceRepositoryError("Select at least one resource root");
      return { ...base, mode: "roots", skillRoots: skills, enabledSkills: [] };
    }
    const catalogued = new Set(fresh.skills.map((entry) => entry.relativePath));
    const chosen = [...new Set(enabledSkills)];
    const stranger = chosen.find((relative) => !catalogued.has(relative));
    if (stranger !== undefined) throw new ResourceRepositoryError(`The selected skill ${stranger} is not in this repository`);
    // An empty selection is a valid enrollment: the catalogue is registered and
    // nothing from it loads until a skill is turned on.
    return { ...base, mode: "collection", skillRoots: [], enabledSkills: chosen };
  }

  async refresh(repositoryIdValue?: string, extensionLock = false): Promise<AgentResourceRepositoryAssessment[]> {
    const repos = repositoryIdValue ? [this.requireRepository(repositoryIdValue)] : [...this.repositories.values()];
    const answers: AgentResourceRepositoryAssessment[] = new Array(repos.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        const repo = repos[index];
        if (!repo) return;
        answers[index] = await this.withLock(repo.path, () => this.assess(repo, extensionLock, true));
      }
    };
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, repos.length) }, worker));
    return answers;
  }

  async update(
    repositoryIdValue: string,
    assessmentToken: string,
    options: ResourceUpdateOptions,
  ): Promise<ResourceUpdateOutcome> {
    const repo = this.repositories.get(repositoryIdValue);
    if (!repo) return { status: "refused", repositoryId: repositoryIdValue, reason: "Unknown resource repository" };
    return this.withLock(repo.path, async () => {
      const expected = this.assessments.get(assessmentToken);
      this.assessments.delete(assessmentToken);
      const issuedUntil = this.issuedAssessmentTokens.get(assessmentToken);
      if (!expected && (issuedUntil === undefined || this.now() > issuedUntil)) {
        throw new ResourceRepositoryError("Unknown update assessment");
      }
      if (
        !expected ||
        this.now() > expected.expiresAt ||
        expected.repositoryId !== repo.id ||
        options.localRevision !== expected.localRevision ||
        options.upstreamRevision !== expected.upstreamRevision
      ) {
        return { status: "refused", repositoryId: repo.id, reason: "The update assessment is stale; check again" };
      }
      if (repo.containsExtensions && options.extensionLock) {
        const assessment = blockedAssessment(repo.id, "locked", "Extension updates are locked by this deployment");
        repo.assessment = assessment;
        return { status: "refused", repositoryId: repo.id, reason: assessment.reason!, assessment };
      }
      if (repo.containsExtensions && options.allowExecutableChanges !== true) {
        return { status: "refused", repositoryId: repo.id, reason: "Updating this repository requires executable-code confirmation" };
      }
      const assessment = await this.assess(repo, options.extensionLock, true);
      if (
        assessment.status !== "updateable" ||
        assessment.branch !== expected.branch ||
        assessment.upstream !== expected.upstream ||
        assessment.localRevision !== expected.localRevision ||
        assessment.upstreamRevision !== expected.upstreamRevision
      ) {
        return { status: "refused", repositoryId: repo.id, reason: "The repository changed after assessment", assessment };
      }
      const blocked = await options.guard?.();
      if (blocked) {
        const busy = blockedAssessment(repo.id, "busy", blocked);
        repo.assessment = busy;
        return { status: "refused", repositoryId: repo.id, reason: blocked, assessment: busy };
      }
      await fs.mkdir(this.hooksDir, { recursive: true });
      await runGit(repo.path, ["-c", `core.hooksPath=${this.hooksDir}`, "merge", "--ff-only", "--no-edit", expected.upstreamRevision]);
      const afterRevision = (await runGit(repo.path, ["rev-parse", "HEAD"])).trim();
      if (afterRevision !== expected.upstreamRevision) {
        throw new ResourceRepositoryError("Git did not advance to the assessed upstream revision");
      }
      repo.assessment = {
        repositoryId: repo.id,
        status: "current",
        branch: expected.branch,
        upstream: expected.upstream,
        localRevision: afterRevision,
        upstreamRevision: afterRevision,
        checkedAt: new Date().toISOString(),
      };
      return {
        status: "updated",
        repositoryId: repo.id,
        beforeRevision: expected.localRevision,
        afterRevision,
        submodulesUpdated: false,
      };
    });
  }

  repositoryPath(repositoryIdValue: string): string | undefined {
    return this.repositories.get(repositoryIdValue)?.path;
  }

  repositoryResources(repositoryIdValue: string): AgentResourceInfo[] {
    return this.repositories.get(repositoryIdValue)?.resources ?? [];
  }

  /** Where a known repository is and what removing it may do, or undefined for an unissued id. */
  repositoryRemoval(repositoryIdValue: string): { path: string; removal: AgentResourceRemoval } | undefined {
    const repo = this.repositories.get(repositoryIdValue);
    return repo ? { path: repo.path, removal: repo.removal } : undefined;
  }

  /**
   * Delete a clone that removing its repository has already unregistered.
   *
   * Every condition is checked again here, under the repository's lock, rather
   * than trusted from the inventory that offered the action: the folder must still
   * be the canonical top level of a Git worktree, must be pi-outpost's (created by
   * its clone, or inside managed storage), and must be neither a filesystem root
   * nor managed storage itself. Symbolic links inside it are unlinked, never
   * followed. A failure is returned as a reason, never thrown past the caller: the
   * repository is already unregistered, and that must still be reported.
   */
  async deleteManagedClone(root: string, managed: boolean): Promise<{ deleted: true } | { deleted: false; failed: boolean; reason: string }> {
    return this.withLock(root, async () => {
      const kept = (reason: string) => ({ deleted: false as const, failed: false, reason });
      const canonical = await canonicalExisting(root);
      if (!canonical) return { deleted: true as const };
      if (canonical !== root) return kept("The repository folder moved or became a link; its files were kept");
      if (path.parse(canonical).root === canonical) return kept("A filesystem root is never deleted");
      const managedRoot = await canonicalExisting(this.managedRoot);
      if (managedRoot === canonical) return kept("Managed resource storage itself is never deleted");
      const inManagedStorage = managedRoot !== undefined && isWithin(managedRoot, canonical);
      if (!managed && !inManagedStorage) return kept("pi-outpost does not manage this folder; its files were kept");
      const topLevel = await tryGit(canonical, ["rev-parse", "--show-toplevel"]);
      const canonicalTopLevel = topLevel ? await canonicalExisting(topLevel.trim()) : undefined;
      if (canonicalTopLevel !== canonical) return kept("The folder is no longer the top of a Git repository; its files were kept");
      try {
        await resourceRemover(canonical);
        return { deleted: true as const };
      } catch (error) {
        return { deleted: false as const, failed: true, reason: `Could not delete every file: ${firstLine(error)}` };
      }
    });
  }

  private requireRepository(id: string): KnownRepository {
    const repo = this.repositories.get(id);
    if (!repo) throw new ResourceRepositoryError("Unknown resource repository");
    return repo;
  }

  private async assess(repo: KnownRepository, extensionLock: boolean, fetch: boolean): Promise<AgentResourceRepositoryAssessment> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const canonical = await canonicalExisting(repo.path);
      if (
        !canonical ||
        canonical !== repo.path ||
        (await enclosingRepository(repo.path)) !== repo.path ||
        (await repositoryFilesystemIdentity(repo.path)) !== repo.filesystemIdentity
      ) {
        return (repo.assessment = {
          ...blockedAssessment(repo.id, "unavailable", "The repository is no longer available at its inventoried path"),
          checkedAt,
        });
      }
      if (extensionLock && repo.containsExtensions) {
        return (repo.assessment = { ...blockedAssessment(repo.id, "locked", "Extension updates are locked by this deployment"), checkedAt });
      }
      const superproject = await tryGit(repo.path, ["rev-parse", "--show-superproject-working-tree"]);
      if (superproject) {
        return (repo.assessment = {
          ...blockedAssessment(repo.id, "unavailable", "A resource repository that is itself a Git submodule cannot be updated"),
          checkedAt,
        });
      }
      const status = await runGit(repo.path, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
      if (status.split("\n").some((line) => /^(1 |2 |u |\? )/.test(line))) {
        return (repo.assessment = { ...blockedAssessment(repo.id, "dirty", "Local changes must be resolved outside the updater"), checkedAt });
      }
      const branch = await tryGit(repo.path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (!branch) return (repo.assessment = { ...blockedAssessment(repo.id, "detached", "The repository has a detached HEAD"), checkedAt });
      const upstream = await tryGit(repo.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
      if (!upstream) return (repo.assessment = { ...blockedAssessment(repo.id, "no-upstream", "The current branch has no upstream"), branch, checkedAt });
      if (fetch) await runGit(repo.path, ["-c", `core.hooksPath=${this.hooksDir}`, "fetch", "--quiet"]);
      const localRevision = (await runGit(repo.path, ["rev-parse", "HEAD"])).trim();
      const upstreamRevision = (await runGit(repo.path, ["rev-parse", "@{upstream}"])).trim();
      const hasSubmodules = await fileExists(path.join(repo.path, ".gitmodules"));
      const base = { repositoryId: repo.id, branch: branch.trim(), upstream: upstream.trim(), localRevision, upstreamRevision, hasSubmodules, checkedAt };
      if (localRevision === upstreamRevision) return (repo.assessment = { ...base, status: "current" });
      if (await exitsZero(repo.path, ["merge-base", "--is-ancestor", localRevision, upstreamRevision])) {
        const token = randomUUID();
        const expiresAt = this.now() + ASSESSMENT_TTL_MS;
        this.assessments.set(token, { ...base, expiresAt });
        this.issuedAssessmentTokens.set(token, expiresAt);
        return (repo.assessment = { ...base, status: "updateable", token });
      }
      if (await exitsZero(repo.path, ["merge-base", "--is-ancestor", upstreamRevision, localRevision])) {
        return (repo.assessment = { ...base, status: "ahead", reason: "The local branch is ahead of its upstream" });
      }
      return (repo.assessment = { ...base, status: "diverged", reason: "The local branch has diverged from its upstream" });
    } catch (error) {
      return (repo.assessment = {
        repositoryId: repo.id,
        status: "failed",
        reason: redactSecrets(firstLine(error)),
        checkedAt,
      });
    }
  }

  private async withLock<T>(root: string, work: () => Promise<T>): Promise<T> {
    const previous = repositoryLocks.get(root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    repositoryLocks.set(root, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (repositoryLocks.get(root) === tail) repositoryLocks.delete(root);
    }
  }
}

async function repositoryFilesystemIdentity(root: string): Promise<string> {
  const gitDirectory = (await runGit(root, ["rev-parse", "--absolute-git-dir"])).trim();
  const stat = await fs.stat(gitDirectory, { bigint: true });
  // Linux filesystems may recycle an inode immediately after a repository is
  // removed. The creation timestamp distinguishes that new directory while
  // keeping the identity stable across ordinary fetches, merges and checkouts.
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

function toWireRepository(repo: KnownRepository): AgentResourceRepository {
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    resourceIds: repo.resources.map((resource) => resource.id).sort(),
    containsExtensions: repo.containsExtensions,
    assessment: repo.assessment,
    ...(repo.collection ? { collection: repo.collection } : {}),
    removal: repo.removal,
  };
}

/**
 * Who may remove a repository, and whether removing it deletes files. A
 * repository supplying a configuration-file path is the operator's; one nobody
 * added through Agent resources is not the dialog's to remove; files are deleted
 * only for a clone pi-outpost made or keeps in its managed storage.
 */
async function removalPolicy(
  input: ResourceInventoryInput,
  managedRoot: string | undefined,
): Promise<(root: string, collection?: SkillCollection) => AgentResourceRemoval> {
  const canonical = async (values: readonly string[]) =>
    (await Promise.all(values.map(canonicalExisting))).filter((value): value is string => value !== undefined);
  const configured = await canonical([...input.configuredSkillPaths, ...input.configuredExtensionPaths]);
  const user = await canonical([...input.userSkillPaths, ...input.userExtensionPaths]);
  return (root, collection) => {
    if (configured.some((entry) => isWithin(root, entry))) {
      return { allowed: false, deletesFiles: false, path: root, reason: "This repository supplies a path from the configuration file, so it can only be removed there" };
    }
    if (!collection && !user.some((entry) => isWithin(root, entry))) {
      return { allowed: false, deletesFiles: false, path: root, reason: "This repository was not added through Agent resources" };
    }
    const inManagedStorage = managedRoot !== undefined && managedRoot !== root && isWithin(managedRoot, root);
    return { allowed: true, deletesFiles: collection?.managed === true || inManagedStorage, path: root };
  };
}

/**
 * Join a repository's catalogue, the selection that is on, and what the runtime
 * actually loaded. A skill that is on but was not loaded says why when it can be
 * told: another skill of the same name reached the loader first.
 */
async function collectionView(
  root: string,
  repositoryName: string,
  collection: SkillCollection,
  loadedSkills: readonly AgentResourceInfo[],
): Promise<AgentResourceCollection> {
  const catalogue = await discoverSkillCatalogue(root);
  const enabled = new Set(collection.enabledSkills);
  const loadedDirs = new Set(loadedSkills.map((resource) => skillDirectoryOf(resource.path!)));
  const skills: AgentCollectionSkill[] = catalogue.skills.map((entry) => {
    if (!enabled.has(entry.relativePath)) return { ...entry, state: "off" };
    const dir = entry.relativePath ? path.join(root, ...entry.relativePath.split("/")) : root;
    if (loadedDirs.has(dir)) return { ...entry, state: "on-loaded" };
    const winner = loadedSkills.find((resource) => resource.name === entry.name);
    return {
      ...entry,
      state: "on-not-loaded",
      reason: winner
        ? `Another skill named "${entry.name}" was loaded first, from ${winner.path}`
        : "The session did not load this skill",
    };
  });
  const catalogued = new Set(catalogue.skills.map((entry) => entry.relativePath));
  for (const relative of collection.enabledSkills) {
    if (!catalogued.has(relative)) skills.push(missingSkill(relative));
  }
  return withGroups(repositoryName, skills, catalogue.bound);
}

function missingSkill(relative: string): AgentCollectionSkill {
  const at = relative.lastIndexOf("/");
  return {
    relativePath: relative,
    name: relative.slice(at + 1) || relative,
    group: at === -1 ? "" : relative.slice(0, at),
    state: "on-missing",
    reason: "This skill is no longer in the repository",
  };
}

function withGroups(
  repositoryName: string,
  skills: AgentCollectionSkill[],
  bound?: AgentResourceCollection["bound"],
): AgentResourceCollection {
  skills.sort((a, b) => a.group.localeCompare(b.group) || a.relativePath.localeCompare(b.relativePath));
  const groups = [...new Set(skills.map((skill) => skill.group))].map((group) => ({ path: group, label: group || repositoryName }));
  return { skills, groups, ...(bound ? { bound } : {}) };
}

/** The runtime reports a skill by its SKILL.md; the catalogue by its directory. */
function skillDirectoryOf(resourcePath: string): string {
  return path.basename(resourcePath) === "SKILL.md" ? path.dirname(resourcePath) : resourcePath;
}

function blockedAssessment(repositoryIdValue: string, status: "unchecked" | "checking"): AgentResourceRepositoryAssessment;
function blockedAssessment(
  repositoryIdValue: string,
  status: Exclude<AgentResourceRepositoryStatus, "unchecked" | "checking" | "current" | "updateable">,
  reason: string,
): AgentResourceRepositoryAssessment;
function blockedAssessment(
  repositoryIdValue: string,
  status: Exclude<AgentResourceRepositoryStatus, "current" | "updateable">,
  reason?: string,
): AgentResourceRepositoryAssessment {
  return { repositoryId: repositoryIdValue, status, ...(reason ? { reason } : {}) } as AgentResourceRepositoryAssessment;
}

function repositoryId(root: string, filesystemIdentity: string): string {
  const existing = repositoryIdentities.get(root);
  if (existing?.filesystemIdentity === filesystemIdentity) return existing.id;
  const id = `resource-repo:${randomUUID()}`;
  repositoryIdentities.set(root, { filesystemIdentity, id });
  return id;
}

async function normalizeResources(
  runtimeResources: AgentResourceInfo[],
  declared: Array<{ kind: AgentResourceKind; path: string; origin: "configured" | "user" }>,
): Promise<AgentResourceInfo[]> {
  const result = new Map<string, AgentResourceInfo>();
  const canonicalDeclared: Array<{ kind: AgentResourceKind; path: string; origin: "configured" | "user" }> = [];
  for (const entry of declared) {
    const canonical = await canonicalExisting(entry.path);
    if (canonical) canonicalDeclared.push({ ...entry, path: canonical });
  }
  for (const resource of runtimeResources) {
    const canonical = resource.path ? await canonicalExisting(resource.path) : undefined;
    const owner = canonical
      ? canonicalDeclared
          .filter((entry) => entry.kind === resource.kind && isWithin(entry.path, canonical!))
          .sort((a, b) => b.path.length - a.path.length)[0]
      : undefined;
    const normalized: AgentResourceInfo = {
      ...resource,
      id: `${resource.kind}:${canonical ?? resource.id}`,
      ...(canonical ? { path: canonical } : {}),
      ...(owner ? { origin: owner.origin, ...(owner.origin === "user" ? { userRoot: owner.path } : {}) } : {}),
    };
    result.set(normalized.id, normalized);
  }
  for (const entry of canonicalDeclared) {
    const alreadyRepresented = [...result.values()].some(
      (resource) => resource.kind === entry.kind && resource.path && isWithin(entry.path, resource.path),
    );
    if (alreadyRepresented) continue;
    const id = `${entry.kind}:${entry.path}`;
    result.set(id, {
      id,
      kind: entry.kind,
      name: path.basename(entry.path) || entry.path,
      origin: entry.origin,
      path: entry.path,
      ...(entry.origin === "user" ? { userRoot: entry.path } : {}),
    });
  }
  return [...result.values()].sort(resourceSort);
}

async function canonicalExisting(value: string): Promise<string | undefined> {
  try {
    return await fs.realpath(path.resolve(value));
  } catch {
    return undefined;
  }
}

async function canonicalDirectory(value: string): Promise<string> {
  try {
    const canonical = await fs.realpath(path.resolve(value));
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch (error) {
    throw new ResourceRepositoryError(`Cannot inspect ${value}: ${firstLine(error)}`);
  }
}

async function enclosingRepository(resourcePath: string): Promise<string | undefined> {
  const canonical = await canonicalExisting(resourcePath);
  if (!canonical) return undefined;
  const cwd = (await fs.stat(canonical)).isDirectory() ? canonical : path.dirname(canonical);
  const answer = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!answer) return undefined;
  const root = await canonicalExisting(answer.trim());
  return root && isWithin(root, canonical) ? root : undefined;
}

async function discoverResourceRoots(
  repositoryRoot: string,
  extensionLock: boolean,
): Promise<AgentResourceRepositoryPreview["roots"]> {
  const roots: AgentResourceRepositoryPreview["roots"] = [];
  const skillCandidates = [repositoryRoot, path.join(repositoryRoot, "skills"), path.join(repositoryRoot, ".agents", "skills")];
  for (const candidate of skillCandidates) {
    const confined = await confinedResourceCandidate(repositoryRoot, candidate);
    if (confined && await containsNamedFile(confined, "SKILL.md", candidate === repositoryRoot ? 0 : 5)) {
      roots.push({ kind: "skill", path: confined, name: relativeName(repositoryRoot, confined) });
    }
  }
  const extensionCandidates = [
    path.join(repositoryRoot, "extensions"),
    path.join(repositoryRoot, ".pi", "extensions"),
    path.join(repositoryRoot, ".agents", "extensions"),
  ];
  for (const candidate of extensionCandidates) {
    const confined = await confinedResourceCandidate(repositoryRoot, candidate);
    if (confined && await containsExtension(confined)) {
      roots.push({
        kind: "extension",
        path: confined,
        name: relativeName(repositoryRoot, confined),
        ...(extensionLock ? { locked: true } : {}),
      });
    }
  }
  return dedupeRoots(roots).sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
}

async function confinedResourceCandidate(repositoryRoot: string, candidate: string): Promise<string | undefined> {
  try {
    const entry = await fs.lstat(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory()) return undefined;
    const canonical = await fs.realpath(candidate);
    // A different canonical spelling means an intermediate directory was a
    // symlink. Preview roots must be owned by the cloned worktree itself: settings
    // persistence canonicalizes them later, so accepting one here could otherwise
    // activate arbitrary code outside the reviewed repository.
    if (canonical !== path.resolve(candidate) || !isWithin(repositoryRoot, canonical)) return undefined;
    return canonical;
  } catch {
    return undefined;
  }
}

async function containsNamedFile(root: string, name: string, maxDepth: number): Promise<boolean> {
  const walk = async (dir: string, depth: number): Promise<boolean> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return false; }
    if (entries.some((entry) => entry.isFile() && entry.name === name)) return true;
    if (depth >= maxDepth) return false;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
      if (await walk(path.join(dir, entry.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(root, 0);
}

export const SKILL_CATALOGUE_MAX_DEPTH = 8;
export const SKILL_CATALOGUE_MAX_SKILLS = 2_000;
const SKILL_CATALOGUE_MAX_BYTES = 16 * 1024;

export interface SkillCatalogue {
  skills: AgentSkillCatalogueEntry[];
  bound?: AgentSkillCatalogueBound;
}

/**
 * Every skill a worktree carries, found by its own folder tree.
 *
 * The walk follows pi's discovery rule — a directory holding `SKILL.md` is one
 * skill and is not descended into — so each entry is exactly what the loader
 * will build from that directory. It reads files and nothing else: no module is
 * imported, no symlink followed, `.git` and `node_modules` are skipped. Depth,
 * count and bytes per file are bounded, and hitting a bound is reported rather
 * than passed off as the whole repository.
 */
export async function discoverSkillCatalogue(
  worktree: string,
  limits: { maxDepth?: number; maxSkills?: number } = {},
): Promise<SkillCatalogue> {
  const maxDepth = limits.maxDepth ?? SKILL_CATALOGUE_MAX_DEPTH;
  const maxSkills = limits.maxSkills ?? SKILL_CATALOGUE_MAX_SKILLS;
  const skills: AgentSkillCatalogueEntry[] = [];
  let bound: AgentSkillCatalogueBound | undefined;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (bound?.kind === "count") return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      if (skills.length >= maxSkills) {
        bound = { kind: "count", limit: maxSkills };
        return;
      }
      skills.push(await catalogueEntry(worktree, dir));
      return;
    }
    const children = entries
      .filter((entry) => entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules")
      .map((entry) => entry.name)
      .sort();
    if (children.length === 0) return;
    if (depth >= maxDepth) {
      bound ??= { kind: "depth", limit: maxDepth };
      return;
    }
    for (const child of children) await walk(path.join(dir, child), depth + 1);
  };
  await walk(worktree, 0);
  skills.sort((a, b) => a.group.localeCompare(b.group) || a.relativePath.localeCompare(b.relativePath));
  return bound ? { skills, bound } : { skills };
}

async function catalogueEntry(worktree: string, dir: string): Promise<AgentSkillCatalogueEntry> {
  const relativePath = path.relative(worktree, dir).split(path.sep).join("/");
  const group = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
  let name: string | undefined;
  let description: string | undefined;
  try {
    const handle = await fs.open(path.join(dir, "SKILL.md"), "r");
    try {
      const buffer = Buffer.alloc(SKILL_CATALOGUE_MAX_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(buffer.subarray(0, bytesRead).toString("utf8"));
      if (typeof frontmatter.name === "string" && frontmatter.name.trim()) name = frontmatter.name.trim();
      if (typeof frontmatter.description === "string" && frontmatter.description.trim()) description = frontmatter.description.trim();
    } finally {
      await handle.close();
    }
  } catch {
    // Unreadable or malformed frontmatter: still a skill directory, named by its folder.
  }
  return {
    relativePath,
    name: name ?? (path.basename(dir) || relativePath),
    ...(description ? { description } : {}),
    group,
  };
}

async function containsExtension(root: string): Promise<boolean> {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return false; }
  if (entries.some((entry) => entry.isFile() && /^(index\.)?(?:[^/]+\.)?(?:ts|js|mjs|cjs)$/.test(entry.name))) return true;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { pi?: { extensions?: unknown } };
    if (Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length > 0) return true;
  } catch { /* metadata-only absence or malformed package */ }
  return false;
}

function relativeName(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/") || path.basename(root);
}

function dedupeRoots(roots: AgentResourceRepositoryPreview["roots"]): AgentResourceRepositoryPreview["roots"] {
  return [...new Map(roots.map((root) => [`${root.kind}:${root.path}`, root])).values()];
}

/**
 * What a preview shows, and the fingerprint a confirmation must match: the roots
 * it can register and, for a collection, the whole catalogue — a skill added or
 * renamed between preview and confirmation invalidates the preview.
 */
async function observeRepository(
  root: string,
  extensionLock: boolean,
  mode: AgentResourceRepositoryPreview["mode"],
): Promise<{ roots: AgentResourceRepositoryPreview["roots"]; skills: AgentSkillCatalogueEntry[]; bound?: AgentSkillCatalogueBound; key: string }> {
  const discovered = await discoverResourceRoots(root, extensionLock);
  const roots = mode === "collection" ? discovered.filter((candidate) => candidate.kind === "extension") : discovered;
  const catalogue = mode === "collection" ? await discoverSkillCatalogue(root) : { skills: [] };
  const key = createHash("sha256").update(JSON.stringify({ mode, roots, catalogue })).digest("hex");
  return { roots, skills: catalogue.skills, ...(catalogue.bound ? { bound: catalogue.bound } : {}), key };
}

/** Whether one of the user's skill roots lies inside this worktree. */
async function enrolledThroughSkillRoots(root: string, userSkillPaths: readonly string[]): Promise<boolean> {
  for (const candidate of userSkillPaths) {
    const canonical = await canonicalExisting(candidate);
    if (canonical && isWithin(root, canonical)) return true;
  }
  return false;
}

function resourceSort(a: AgentResourceInfo, b: AgentResourceInfo): number {
  return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const env = nonInteractiveEnv();
  resourceGitObserver?.({ phase: "start", cwd, args, env });
  try {
    const { stdout } = await execFileAsync(currentGitExecutable(), args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
      env,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new ResourceRepositoryError(stderr?.trim().split("\n")[0] || `git ${args[0]} failed`);
  } finally {
    resourceGitObserver?.({ phase: "end", cwd, args, env });
  }
}

async function fileExists(value: string): Promise<boolean> {
  try { await fs.access(value); return true; } catch { return false; }
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try { return (await runGit(cwd, args)).trim(); } catch { return undefined; }
}

async function exitsZero(cwd: string, args: string[]): Promise<boolean> {
  try { await runGit(cwd, args); return true; } catch { return false; }
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}

async function canonicalCloneDestination(value: string): Promise<string> {
  const requested = path.resolve(value.trim());
  const parsed = path.parse(requested);
  if (!value.trim() || requested === parsed.root || !parsed.base || parsed.base === "." || parsed.base === "..") {
    throw new ResourceRepositoryError("Choose a local folder below an existing parent directory");
  }
  let parent: string;
  try {
    parent = await fs.realpath(parsed.dir);
    if (!(await fs.stat(parent)).isDirectory()) throw new Error("parent is not a directory");
  } catch {
    throw new ResourceRepositoryError("The local folder's parent directory does not exist");
  }
  if (parsed.base.includes(path.sep) || (path.sep === "\\" && parsed.base.includes("/"))) {
    throw new ResourceRepositoryError("The local folder must end in one directory name");
  }
  return path.join(parent, parsed.base);
}

export function validateRepositoryAddress(value: string): string {
  const address = value.trim();
  if (!address || address.startsWith("-") || /[\0\r\n]/.test(address)) {
    throw new ResourceRepositoryError("Enter a valid Git repository address");
  }
  const supported = /^(?:https|ssh|git|file):\/\//i.test(address) || /^[^\s@/:]+@[^\s:]+:.+/.test(address);
  if (!supported || /[<>|`$;&]/.test(address)) {
    throw new ResourceRepositoryError("Use an HTTPS, SSH, Git, file, or user@host:path repository address");
  }
  return address;
}

function repositoryAddressIdentity(address: string): string {
  if (path.isAbsolute(address)) return path.resolve(address);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) {
    try {
      const parsed = new URL(address);
      if (parsed.protocol === "file:") return path.resolve(fileURLToPath(parsed));
      parsed.username = "";
      parsed.password = "";
      return parsed.toString().replace(/\/$/, "");
    } catch { return address; }
  }
  return address;
}

function redactRepositoryAddress(address: string): string {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(address)) return address;
  try {
    const parsed = new URL(address);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "";
    }
    return parsed.toString();
  } catch { return "repository address"; }
}

function repositoryAddressWithoutCredentials(address: string): string {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(address)) return address;
  try {
    const parsed = new URL(address);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return address;
  }
}

function redactSecrets(message: string): string {
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1***@");
}

function trimTrailingAddressSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "/" || value[end - 1] === "\\")) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function trimBoundaryHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start += 1;
  while (end > start && value[end - 1] === "-") end -= 1;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/**
 * The name a repository goes by: the last segment of its `origin` address, as its
 * owner spelled it. The folder is a local choice — a suggested clone folder carries
 * a hash suffix, and the user may have named it anything — so it is only the
 * fallback, for a worktree with no origin.
 */
async function repositoryDisplayName(root: string): Promise<string> {
  const origin = (await tryGit(root, ["remote", "get-url", "origin"]))?.trim();
  if (origin) {
    const suffix = [origin.indexOf("?"), origin.indexOf("#")].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    const clean = trimTrailingAddressSeparators(suffix === undefined ? origin : origin.slice(0, suffix));
    const tail = clean.split(/[\\/:]/).at(-1)?.replace(/\.git$/i, "");
    if (tail) return tail;
  }
  return path.basename(root) || root;
}

function repositorySlug(address: string): string {
  const suffix = [address.indexOf("?"), address.indexOf("#")].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const cleanAddress = trimTrailingAddressSeparators(suffix === undefined ? address : address.slice(0, suffix));
  const tail = cleanAddress.split(/[\\/:]/).at(-1)?.replace(/\.git$/i, "") ?? "repository";
  const slug = trimBoundaryHyphens(tail.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  return slug || "repository";
}
