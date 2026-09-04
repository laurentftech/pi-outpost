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
  AgentResourceInfo,
  AgentResourceInventory,
  AgentResourceKind,
  AgentResourceRepository,
  AgentResourceRepositoryAssessment,
  AgentResourceRepositoryPreview,
  AgentResourceRepositoryStatus,
} from "@pi-outpost/shared";
import { currentGitExecutable } from "./git.ts";
import { userConfigDir } from "./config.ts";
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
}

interface PreviewRecord {
  preview: AgentResourceRepositoryPreview;
  rootsKey: string;
  expiresAt: number;
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
      next.set(id, {
        id,
        path: root,
        filesystemIdentity,
        name: path.basename(root) || root,
        resources: repoResources,
        containsExtensions,
        assessment,
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

  async preview(selectedPath: string, extensionLock: boolean): Promise<AgentResourceRepositoryPreview> {
    const selected = await canonicalDirectory(selectedPath);
    const root = await enclosingRepository(selected);
    if (!root) throw new ResourceRepositoryError("The selected directory is not inside a Git worktree");
    const roots = await discoverResourceRoots(root, extensionLock);
    if (roots.length === 0) throw new ResourceRepositoryError("No recognizable skill or extension roots were found in this repository");
    const headRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();
    const token = randomUUID();
    const preview: AgentResourceRepositoryPreview = {
      token,
      repositoryPath: root,
      repositoryName: path.basename(root) || root,
      headRevision,
      roots,
    };
    this.previews.set(token, { preview, rootsKey: rootsFingerprint(roots), expiresAt: this.now() + PREVIEW_TTL_MS });
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

  async cloneAndPreview(repositoryUrl: string, destinationPath: string, extensionLock: boolean): Promise<AgentResourceRepositoryPreview> {
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
    const preview = await this.preview(destination, extensionLock);
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
  ): Promise<{ repositoryPath: string; skillRoots: string[]; extensionRoots: string[] }> {
    const record = this.previews.get(token);
    this.previews.delete(token);
    if (!record) throw new ResourceRepositoryError("This repository preview is no longer valid; preview it again");
    if (this.now() > record.expiresAt) throw new ResourceRepositoryError("This repository preview has expired; preview it again");
    const fresh = await discoverResourceRoots(record.preview.repositoryPath, extensionLock);
    const head = (await runGit(record.preview.repositoryPath, ["rev-parse", "HEAD"])).trim();
    if (head !== record.preview.headRevision || rootsFingerprint(fresh) !== record.rootsKey) {
      throw new ResourceRepositoryError("The repository changed after preview; preview it again");
    }
    const permitted = new Map(fresh.map((root) => [`${root.kind}:${root.path}`, root]));
    const select = (kind: AgentResourceKind, values: string[]) =>
      [...new Set(values)].map((value) => {
        const candidate = permitted.get(`${kind}:${value}`);
        if (!candidate || candidate.locked) throw new ResourceRepositoryError(`The selected ${kind} root is unavailable`);
        return candidate.path;
      });
    const skills = select("skill", skillRoots);
    const extensions = select("extension", extensionRoots);
    if (skills.length + extensions.length === 0) throw new ResourceRepositoryError("Select at least one resource root");
    return { repositoryPath: record.preview.repositoryPath, skillRoots: skills, extensionRoots: extensions };
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
  };
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

function rootsFingerprint(roots: AgentResourceRepositoryPreview["roots"]): string {
  return createHash("sha256").update(JSON.stringify(roots)).digest("hex");
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

function repositorySlug(address: string): string {
  const suffix = [address.indexOf("?"), address.indexOf("#")].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const cleanAddress = trimTrailingAddressSeparators(suffix === undefined ? address : address.slice(0, suffix));
  const tail = cleanAddress.split(/[\\/:]/).at(-1)?.replace(/\.git$/i, "") ?? "repository";
  const slug = trimBoundaryHyphens(tail.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  return slug || "repository";
}
