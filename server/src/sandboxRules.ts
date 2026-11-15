/**
 * The user's durable sandbox rules, and the refusals they are made from, per project
 * (`durable-sandbox-rules`).
 *
 * A rule names a resource, never a command: a directory with an access, or a host. It says
 * always allow or always refuse; "ask" is no rule at all. It lasts across sessions and restarts.
 *
 * The store is a file per project under the agent directory — beside the sessions, the server's
 * other per-project state — and never in the project tree or the configuration file: the first
 * would let a confined command rewrite its own rules, the second belongs to the operator. Under the
 * agent directory it is out of every confined command's reach and of every grant: each runner's
 * policy denies the agent directory by name, and `sandboxGrants.ts` refuses a grant within it.
 *
 * Only the interface creates, changes or revokes a rule (`OnlyTheUserMakesARule`): nothing here is
 * offered to the agent.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { refusalKey, type Refusal } from "./sandboxRefusals.ts";
import type { GrantAccess } from "./sandboxGrants.ts";

export type RuleDecision = "allow" | "refuse";

export type SandboxRule =
  | { id: string; kind: "directory"; target: string; access: GrantAccess; decision: RuleDecision; createdAt: string }
  | { id: string; kind: "host"; target: string; decision: RuleDecision; createdAt: string };

/** A refusal as the project keeps it: the last command that met it, when, and how often. */
export type RecordedRefusal = Refusal & { key: string; count: number; lastSeen: string };

interface StoreFile {
  version: 1;
  /** The project root the file is for, as given: shown, and checked against the name. */
  root: string;
  rules: SandboxRule[];
  refusals: RecordedRefusal[];
}

/** The most refusals a project keeps: the oldest seen go first. */
export const MAX_RECORDED_REFUSALS = 200;

/** Where the rules of every project are: under the agent directory, out of every sandbox's reach. */
export function rulesDirectory(agentDir: string): string {
  return path.join(agentDir, "pi-outpost", "sandbox-rules");
}

/** A root as compared: resolved, and without case on Windows. */
function rootKey(root: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(root);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** One project's file: named by a hash of its root, so no path of the project appears in a name. */
export function rulesFile(agentDir: string, root: string, platform: NodeJS.Platform = process.platform): string {
  const hash = createHash("sha256").update(rootKey(root, platform)).digest("hex").slice(0, 32);
  return path.join(rulesDirectory(agentDir), `${hash}.json`);
}

/** The same resource, whatever the decision: two rules never name one resource. */
function sameResource(a: Pick<SandboxRule, "kind" | "target"> & { access?: GrantAccess }, b: Pick<SandboxRule, "kind" | "target"> & { access?: GrantAccess }, platform: NodeJS.Platform): boolean {
  const target = (t: string) => (a.kind === "host" || platform === "win32" ? t.toLowerCase() : t);
  return a.kind === b.kind && target(a.target) === target(b.target) && (a.kind === "host" || a.access === b.access);
}

export interface SandboxRulesStoreOptions {
  agentDir: string;
  root: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

/** One project's rules and recorded refusals. Writes are serialised and atomic. */
export class SandboxRulesStore {
  readonly file: string;
  private readonly root: string;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(options: SandboxRulesStoreOptions) {
    this.platform = options.platform ?? process.platform;
    this.root = path.resolve(options.root);
    this.file = rulesFile(options.agentDir, options.root, this.platform);
    this.now = options.now ?? (() => new Date());
  }

  /** The project's rules, read from the file each time: a revoke applies from the next command. */
  async rules(): Promise<SandboxRule[]> {
    return (await this.settled()).rules;
  }

  async refusals(): Promise<RecordedRefusal[]> {
    return (await this.settled()).refusals;
  }

  /** The file once every write asked for before is done: a rule just made is read back. */
  private settled(): Promise<StoreFile> {
    return this.queue.then(() => this.read());
  }

  /** Records one refusal: a new one, or the last time an old one was met. Information too. */
  record(refusal: Refusal): Promise<void> {
    return this.update((store) => {
      const key = refusalKey(refusal);
      const lastSeen = this.now().toISOString();
      const existing = store.refusals.find((recorded) => recorded.key === key);
      const rest = store.refusals.filter((recorded) => recorded !== existing);
      const entry: RecordedRefusal = { ...refusal, key, count: (existing?.count ?? 0) + 1, lastSeen };
      store.refusals = [...rest, entry].slice(-MAX_RECORDED_REFUSALS);
    });
  }

  /**
   * Makes a rule, replacing any other on the same resource. Called from the interface alone. The
   * caller has checked the target may take one (`sandboxGrants.ts`) for an always-allow rule.
   */
  setRule(rule: { kind: "directory"; target: string; access: GrantAccess; decision: RuleDecision } | { kind: "host"; target: string; decision: RuleDecision }): Promise<SandboxRule> {
    let made: SandboxRule | undefined;
    return this.update((store) => {
      const base = { id: randomUUID(), createdAt: this.now().toISOString(), decision: rule.decision };
      made = rule.kind === "host" ? { ...base, kind: "host", target: rule.target.toLowerCase() } : { ...base, kind: "directory", target: path.resolve(rule.target), access: rule.access };
      store.rules = [...store.rules.filter((existing) => !sameResource(existing, made!, this.platform)), made];
    }).then(() => made!);
  }

  /** Told after every change that was kept: a rule made or revoked, a refusal recorded. Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Revokes a rule: true when there was one with this id. */
  revoke(id: string): Promise<boolean> {
    let found = false;
    return this.update((store) => {
      found = store.rules.some((rule) => rule.id === id);
      store.rules = store.rules.filter((rule) => rule.id !== id);
    }).then(() => found);
  }

  private async read(): Promise<StoreFile> {
    const empty: StoreFile = { version: 1, root: this.root, rules: [], refusals: [] };
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    // A file for another root under this name would be a collision, or a file put there: not ours.
    if (typeof parsed.root !== "string" || rootKey(parsed.root, this.platform) !== rootKey(this.root, this.platform)) {
      throw new Error(`${this.file} holds the rules of another project`);
    }
    return {
      version: 1,
      root: this.root,
      rules: Array.isArray(parsed.rules) ? parsed.rules.filter(isRule) : [],
      refusals: Array.isArray(parsed.refusals) ? parsed.refusals : [],
    };
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
    // One failed write does not stop the next.
    this.queue = next.catch(() => {});
    return next.then(() => {
      for (const listener of this.listeners) listener();
    });
  }
}

/** An "always" answer to a grant request: one rule per target, each replacing any other on it. */
export async function makeRulesFromGrant(store: SandboxRulesStore, grant: { hosts: string[]; directories: Array<{ path: string; access: GrantAccess }> }, decision: RuleDecision): Promise<void> {
  for (const host of grant.hosts) await store.setRule({ kind: "host", target: host, decision });
  for (const directory of grant.directories) await store.setRule({ kind: "directory", target: directory.path, access: directory.access, decision });
}

/** One store per project file for the server's life: its writes are serialised, so never two. */
const stores = new Map<string, SandboxRulesStore>();

export function rulesStoreFor(agentDir: string, root: string, platform: NodeJS.Platform = process.platform): SandboxRulesStore {
  const file = rulesFile(agentDir, root, platform);
  let store = stores.get(file);
  if (!store) {
    store = new SandboxRulesStore({ agentDir, root, platform });
    stores.set(file, store);
  }
  return store;
}

/** What the rules say of a host: the decision of the rule naming it, or undefined for none. */
export function hostDecision(rules: readonly SandboxRule[], host: string): RuleDecision | undefined {
  const name = host.toLowerCase();
  return rules.find((rule) => rule.kind === "host" && rule.target === name)?.decision;
}

function within(child: string, parent: string, platform: NodeJS.Platform): boolean {
  // The platform's own paths, whatever host this runs on: a Windows rule read on Linux is still one.
  const paths = platform === "win32" ? path.win32 : path.posix;
  const norm = (p: string) => (platform === "win32" ? p.toLowerCase() : p);
  const relative = paths.relative(norm(parent), norm(child));
  return relative === "" || (!relative.startsWith("..") && !paths.isAbsolute(relative));
}

/**
 * What the rules say of a directory request. Refused when a refuse rule covers it or lies inside
 * it — granting a parent would grant what the user refused — and a write is refused by a refuse
 * rule on reading too. Allowed when an allow rule covers it with enough access: a write rule
 * covers reading. Refusal wins.
 */
export function directoryDecision(rules: readonly SandboxRule[], directory: string, access: GrantAccess, platform: NodeJS.Platform = process.platform): RuleDecision | undefined {
  const dirs = rules.filter((rule): rule is Extract<SandboxRule, { kind: "directory" }> => rule.kind === "directory");
  const refused = dirs.some(
    (rule) => rule.decision === "refuse" && (rule.access === access || rule.access === "read") && (within(directory, rule.target, platform) || within(rule.target, directory, platform)),
  );
  if (refused) return "refuse";
  const allowed = dirs.some((rule) => rule.decision === "allow" && (rule.access === access || rule.access === "write") && within(directory, rule.target, platform));
  return allowed ? "allow" : undefined;
}

function isRule(value: unknown): value is SandboxRule {
  const rule = value as Partial<SandboxRule> | null;
  return (
    typeof rule?.id === "string" &&
    typeof rule.target === "string" &&
    (rule.decision === "allow" || rule.decision === "refuse") &&
    (rule.kind === "host" || (rule.kind === "directory" && ((rule as { access?: unknown }).access === "read" || (rule as { access?: unknown }).access === "write")))
  );
}
