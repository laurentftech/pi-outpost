/**
 * The project's extensions run only once the user has allowed them (`project-extension-approval`).
 *
 * A pi extension is a module pi imports into this process: it runs outside the sandbox, with every
 * right of the account and the provider keys within reach. The agent may write one — that is part
 * of what pi is — so what the project brings (`.pi/extensions/`, the extensions and packages its
 * `.pi/settings.json` names) is loaded only when the user has allowed that exact content. pi's own
 * project trust is all or nothing and an SDK host starts trusted, and its `extensionsOverride`
 * filters after import, when the module has already run: the gate is the project settings pi reads,
 * which here exclude by exact path (`-<path>`) what is not allowed, and leave out a package not
 * allowed before pi installs it.
 *
 * Decisions live under the agent directory, beside the sandbox rules: out of every confined
 * command's reach. Only the interface makes one, and installing a package from Settings is one.
 */
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

export type ExtensionDecision = "allow" | "refuse";

/** One thing the project would have pi load: an extension file, or a package to install. */
export interface ExtensionCandidate {
  kind: "file" | "package";
  /** The file pi would import (absolute), or the package's source as the settings write it. */
  key: string;
  /** What is hashed for a file: itself, or the directory of a directory extension. */
  contentPath?: string;
  /** SHA-256 of what would run: the file, every file of the directory, or the package entry. */
  hash: string;
  /** For the dialog: the path from the project, or the package source. */
  label: string;
  /** Bytes of what was hashed (files only). */
  size?: number;
}

export interface ExtensionDecisionRecord {
  kind: "file" | "package";
  key: string;
  label: string;
  hash: string;
  decision: ExtensionDecision;
  decidedAt: string;
}

interface StoreFile {
  version: 1;
  root: string;
  decisions: ExtensionDecisionRecord[];
}

const rootKey = (root: string, platform: NodeJS.Platform) => {
  const resolved = path.resolve(root);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
};

const keyOf = (kind: string, key: string, platform: NodeJS.Platform) => `${kind}\0${kind === "file" && platform === "win32" ? key.toLowerCase() : key}`;

/** Where one project's decisions are: under the agent directory, named by a hash of the root. */
export function approvalsFile(agentDir: string, root: string, platform: NodeJS.Platform = process.platform): string {
  const hash = createHash("sha256").update(rootKey(root, platform)).digest("hex").slice(0, 32);
  return path.join(agentDir, "pi-outpost", "extension-approvals", `${hash}.json`);
}

/** One project's decisions. Writes are serialised and atomic, like the sandbox rules'. */
export class ExtensionApprovalStore {
  readonly file: string;
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    agentDir: string,
    root: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.root = path.resolve(root);
    this.file = approvalsFile(agentDir, root, platform);
  }

  async decisions(): Promise<ExtensionDecisionRecord[]> {
    return (await this.queue.then(() => this.read())).decisions;
  }

  /** The decision for this exact content, or undefined: a changed file has none. */
  async decisionFor(candidate: ExtensionCandidate): Promise<ExtensionDecision | undefined> {
    const key = keyOf(candidate.kind, candidate.key, this.platform);
    return (await this.decisions()).find((record) => keyOf(record.kind, record.key, this.platform) === key && record.hash === candidate.hash)?.decision;
  }

  decide(candidate: ExtensionCandidate, decision: ExtensionDecision): Promise<void> {
    return this.update((store) => {
      const key = keyOf(candidate.kind, candidate.key, this.platform);
      store.decisions = [
        ...store.decisions.filter((record) => keyOf(record.kind, record.key, this.platform) !== key),
        { kind: candidate.kind, key: candidate.key, label: candidate.label, hash: candidate.hash, decision, decidedAt: this.now().toISOString() },
      ];
    });
  }

  /** Withdraws the decision on `key`: true when there was one. It is asked about again. */
  withdraw(kind: "file" | "package", key: string): Promise<boolean> {
    let found = false;
    return this.update((store) => {
      const wanted = keyOf(kind, key, this.platform);
      found = store.decisions.some((record) => keyOf(record.kind, record.key, this.platform) === wanted);
      store.decisions = store.decisions.filter((record) => keyOf(record.kind, record.key, this.platform) !== wanted);
    }).then(() => found);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async read(): Promise<StoreFile> {
    const empty: StoreFile = { version: 1, root: this.root, decisions: [] };
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    if (typeof parsed.root !== "string" || rootKey(parsed.root, this.platform) !== rootKey(this.root, this.platform)) {
      throw new Error(`${this.file} holds the extension decisions of another project`);
    }
    return { version: 1, root: this.root, decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter(isRecord) : [] };
  }

  private update(change: (store: StoreFile) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const store = await this.read();
      change(store);
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await fs.rename(temporary, this.file);
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw error;
      }
    });
    this.queue = next.catch(() => {});
    return next.then(() => {
      for (const listener of this.listeners) listener();
    });
  }
}

function isRecord(value: unknown): value is ExtensionDecisionRecord {
  const record = value as Partial<ExtensionDecisionRecord> | null;
  return (
    (record?.kind === "file" || record?.kind === "package") &&
    typeof record.key === "string" &&
    typeof record.hash === "string" &&
    typeof record.label === "string" &&
    (record.decision === "allow" || record.decision === "refuse")
  );
}

const stores = new Map<string, ExtensionApprovalStore>();

/** One store per project for the server's life: its writes are serialised, so never two. */
export function approvalStoreFor(agentDir: string, root: string): ExtensionApprovalStore {
  // The project as the workspace knows it: symlinks resolved, whichever spelling the caller had.
  try {
    root = realpathSync.native(root);
  } catch {
    root = path.resolve(root);
  }
  const file = approvalsFile(agentDir, root);
  let store = stores.get(file);
  if (!store) {
    store = new ExtensionApprovalStore(agentDir, root);
    stores.set(file, store);
  }
  return store;
}

/** Directories a directory extension's hash leaves out: what an install puts there, not its code. */
const NOT_HASHED = new Set(["node_modules", ".git"]);

async function hashOf(target: string): Promise<{ hash: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const walk = async (current: string, relative: string): Promise<void> => {
    const stat = await fs.lstat(current);
    if (stat.isDirectory()) {
      const entries = (await fs.readdir(current)).filter((name) => !NOT_HASHED.has(name)).sort();
      for (const name of entries) await walk(path.join(current, name), relative ? `${relative}/${name}` : name);
      return;
    }
    if (!stat.isFile()) return;
    const bytes = await fs.readFile(current);
    size += bytes.byteLength;
    hash.update(`${relative}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  };
  await walk(target, "");
  return { hash: hash.digest("hex"), size };
}

/** What a package entry of the settings says, as one comparable string. */
const packageKey = (entry: unknown): string | undefined =>
  typeof entry === "string" ? entry : entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string" ? JSON.stringify(entry) : undefined;

const packageLabel = (entry: unknown): string => (typeof entry === "string" ? entry : String((entry as { source: string }).source));

/**
 * What the project would have pi load, found the way pi finds it and without importing anything:
 * pi's own resolution, on settings whose project packages are withheld so nothing is installed just
 * to be listed. Its files, and its packages by their entry.
 */
export async function projectExtensionCandidates(cwd: string, agentDir: string): Promise<ExtensionCandidate[]> {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const projectSettings = settingsManager.getProjectSettings();
  const read = settingsManager.getProjectSettings.bind(settingsManager);
  settingsManager.getProjectSettings = () => ({ ...read(), packages: [] });
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const resolved = await manager.resolve(async () => "skip");
  const extensionsDir = path.join(cwd, ".pi", "extensions");
  const candidates: ExtensionCandidate[] = [];
  for (const resource of resolved.extensions) {
    if (resource.metadata.scope !== "project" || resource.metadata.origin !== "top-level") continue;
    if (resource.path.startsWith("builtin:")) continue;
    const file = path.resolve(resource.path);
    // A directory extension is found by its entry: its code is the whole directory.
    const parent = path.dirname(file);
    const isDirectoryEntry = /^index\.[cm]?[jt]sx?$/i.test(path.basename(file)) && path.dirname(parent) === extensionsDir;
    const contentPath = isDirectoryEntry ? parent : file;
    let measured: { hash: string; size: number };
    try {
      measured = await hashOf(contentPath);
    } catch {
      continue; // gone, or unreadable: pi will not load it either
    }
    candidates.push({ kind: "file", key: file, contentPath, hash: measured.hash, size: measured.size, label: path.relative(cwd, contentPath).split(path.sep).join("/") });
  }
  for (const entry of projectSettings.packages ?? []) {
    const key = packageKey(entry);
    if (key === undefined) continue;
    candidates.push({ kind: "package", key, hash: createHash("sha256").update(key).digest("hex"), label: packageLabel(entry) });
  }
  return candidates;
}

/**
 * A package as the settings will write it, allowed by being installed from Settings: the user's
 * own hand, so not asked about again.
 */
export function packageCandidate(source: string): ExtensionCandidate {
  return { kind: "package", key: source, hash: createHash("sha256").update(source).digest("hex"), label: source };
}

export interface ExtensionGate {
  /** The settings manager to give pi: project settings without what is not allowed. */
  settingsManager: SettingsManager;
  /** Candidates with no decision for their content: to be asked about. */
  undecided: ExtensionCandidate[];
  /** Candidates kept out: undecided and refused. */
  excluded: ExtensionCandidate[];
}

/** The settings pi is to read for this project: every file and package not allowed, left out. */
export async function extensionGate(cwd: string, agentDir: string, store: ExtensionApprovalStore): Promise<ExtensionGate> {
  const candidates = await projectExtensionCandidates(cwd, agentDir);
  const undecided: ExtensionCandidate[] = [];
  const excluded: ExtensionCandidate[] = [];
  for (const candidate of candidates) {
    const decision = await store.decisionFor(candidate);
    if (decision === "allow") continue;
    excluded.push(candidate);
    if (decision === undefined) undecided.push(candidate);
  }
  const excludedFiles = excluded.filter((candidate) => candidate.kind === "file").map((candidate) => `-${candidate.key}`);
  const excludedPackages = new Set(excluded.filter((candidate) => candidate.kind === "package").map((candidate) => candidate.key));
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const read = settingsManager.getProjectSettings.bind(settingsManager);
  settingsManager.getProjectSettings = () => {
    const settings = read();
    return {
      ...settings,
      extensions: [...(settings.extensions ?? []), ...excludedFiles],
      packages: (settings.packages ?? []).filter((entry) => {
        const key = packageKey(entry);
        return key === undefined || !excludedPackages.has(key);
      }),
    };
  };
  return { settingsManager, undecided, excluded };
}
