/**
 * A workspace: one project the server holds open, and everything rooted at it.
 *
 * Before this existed, all of it lived as module-level bindings in index.ts —
 * `AGENT_CWD`, `BROWSER_ROOT`, `WRITABLE_ROOT`, `GIT`, `fileWatcher`,
 * `sandboxedTools`, `runtime`, `activeWorkPlan` — established once at boot and
 * never re-owned. That shape is what makes a server serve exactly one project:
 * there is no second copy of any of it to hand a second project.
 *
 * The set of fields here is not a design; it is an inventory. `handleUpdateConfig`
 * already had to rebuild precisely this list when the sandbox root moved, which is
 * how we know it is complete: anything it forgot would already be a bug today.
 *
 * What a workspace deliberately does NOT own: the HTTP server, the client set, the
 * credential store, and the agentDir. Those are the server's, shared across every
 * workspace, and duplicating them would fragment state that is genuinely global.
 */
import fs from "node:fs/promises";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentRuntime } from "./agentRuntime.ts";
import type { SandboxConfig } from "./config.ts";
import { DOCUMENT_TOOLS } from "./documentTools.ts";
import { type DirectoryWatcher, createDirectoryWatcher } from "./fileWatcher.ts";
import { resolveBrowserRoot, resolveWritableRoot } from "./fileBrowser.ts";
import { discoverRepos, whyGitCannotServe, type GitRepo } from "./git.ts";
import { ExtensionRenderer } from "./extensionRender.ts";
import { createSandboxedTools } from "./sandbox.ts";
import type { ExtensionUIRequest, GitUnavailable, WorkPlan } from "@pi-outpost/shared";

/**
 * What a workspace needs to know about itself. A narrow slice of AppConfig rather
 * than the whole thing: everything else in that object is server-wide, and taking
 * the whole config here would let a second workspace read the first one's settings
 * by accident.
 */
export interface WorkspaceSettings {
  /** The project directory. Also the workspace's identity — see `Workspace.root`. */
  cwd: string;
  sandbox?: SandboxConfig;
}

/**
 * How long a burst of disk activity is collected before the repository set is
 * scanned again. The window opens on the first change and is not extended: a clone
 * writes continuously, and a resetting debounce would never fire while it did.
 */
const REPO_RESCAN_DEBOUNCE_MS = 500;

/** Server-wide limits a workspace passes through when it builds its toolset. */
export interface WorkspaceToolLimits {
  pdfMaxBytes: number;
  docxMaxBytes: number;
  xlsxMaxBytes: number;
  pptxMaxBytes: number;
  structuredExchangeMaxBytes: number;
}

/** Facts needed to decide whether an open workspace may release its resources. */
export interface WorkspaceRetirementState {
  timeoutMs: number;
  now: number;
  lastUsedAt: number;
  watched: boolean;
  busy: boolean;
  readyForReview: boolean;
}

/**
 * Retirement policy kept independent from the timer that applies it, so the
 * disabled and busy boundaries are exact decisions rather than timing tests.
 */
export function shouldRetireWorkspace(state: WorkspaceRetirementState): boolean {
  return (
    state.timeoutMs > 0 &&
    !state.watched &&
    !state.busy &&
    !state.readyForReview &&
    state.now - state.lastUsedAt >= state.timeoutMs
  );
}

export interface WorkspaceOptions {
  settings: WorkspaceSettings;
  limits: WorkspaceToolLimits;
  /** Whether to watch the browser root. Server-wide (`config.files.watch`). */
  watchFiles: boolean;
  /**
   * Tools that are the same on both sides of the sandbox — they read and write
   * nothing on disk, so they are not confined and are appended to every toolset.
   */
  unconfinedTools: ToolDefinition[];
  /**
   * Where a directory change in THIS workspace goes. Scoped by the caller: a
   * watcher fires for one project's tree, and only clients bound to that project
   * may hear about it.
   */
  onDirectoryChanged: (relPath: string) => void;
  /**
   * Where "this workspace's repository set changed" goes. Called only when the set
   * differs from the one it replaces, so a quiet re-scan says nothing.
   */
  onRepositoriesChanged?: () => void;
  /**
   * Builds the agent runtime for this workspace. Injected because the two runtime
   * flavours are assembled from configuration this object deliberately cannot see
   * (extensions, skills, prompt templates, RPC arguments).
   */
  createRuntime: (settings: WorkspaceSettings, sandboxedTools: ToolDefinition[] | undefined) => Promise<AgentRuntime>;
}

export class Workspace {
  /**
   * Identity is the resolved root path — no generated id to persist and reconcile.
   * Opening a directory that is already open is therefore a lookup rather than a
   * duplicate, and a reopened project finds its own history, since `SessionManager`
   * is already keyed by cwd.
   */
  readonly root: string;

  settings: WorkspaceSettings;

  /**
   * Renders this project's tool cards and custom messages, using the renderers
   * ITS extensions provide and its own cwd. Per-workspace because the alternative
   * was a process-wide one, configured by whichever project started last.
   */
  readonly renderer = new ExtensionRenderer();

  browserRoot: string;
  writableRoot: string | null | undefined;
  /**
   * Every repository serving this workspace, deepest-first. A set rather than one:
   * a project directory may be inside a repository, hold several underneath it, or
   * both, and a path is answered by whichever owns it.
   */
  repos: GitRepo[];
  /** Why `repos` is empty, when it is. Undefined whenever the workspace holds one. */
  gitUnavailable: GitUnavailable | undefined;
  fileWatcher: DirectoryWatcher | undefined;
  sandboxedTools: ToolDefinition[] | undefined;

  /**
   * How many turns each published document extractor has gone unused, and whether it was
   * ever used at all.
   *
   * A prompt naming `report.pdf` publishes `pdf_extract` before the turn goes out, and
   * the tool then has to earn its place in every later request. Two thresholds, because
   * the two silences mean different things: a tool that was **never** called was
   * published on a wrong guess — a file that does not exist, a document named in passing
   * — and goes at the end of that turn. One that **was** called is kept while the work
   * around it continues, since extraction is rarely a single call, and is forgotten only
   * once the conversation has plainly moved on.
   *
   * Naming the document again republishes it: that is the only way back, and it is the
   * user's to take, since an agent cannot ask for a tool it can no longer see.
   */
  documentToolIdleTurns = new Map<string, number>();
  documentToolsEverUsed = new Set<string>();

  /** Loaded from the runtime's session file by the caller; null until then. */
  workPlan: WorkPlan | null = null;
  workPlanSessionFile: string | undefined;
  /**
   * Serialises writes to THIS workspace's plan. Per-workspace rather than global:
   * a shared chain would make two projects wait on each other's plan writes, which
   * is a queue neither of them has any reason to be in.
   */
  workPlanSync: Promise<void> = Promise.resolve();
  /** Session file a fork is inheriting its plan from, while that is in flight. */
  workPlanInheritanceSource: string | undefined;

  /**
   * The dialogs this project's turn is blocked on, by id.
   *
   * Stored rather than derived: the runtime knows a request is outstanding, but not
   * that it is one a human must resolve, and a client bound to another project must
   * be able to learn this without subscribing to the conversation carrying it.
   *
   * The REQUEST is kept, not merely its id, because a client that comes back to
   * this project has to be shown the question again — it was sent once, to whoever
   * was bound at the time, and a switch away and back would otherwise leave a turn
   * blocked on a question nobody can reach any more.
   *
   * A map rather than a flag: several can be outstanding at once, and answering one
   * of them does not unblock the turn. Attention is "this map is non-empty", so it
   * clears when the last question is answered and not before.
   */
  readonly pendingDialogs = new Map<string, ExtensionUIRequest>();

  get needsAttention(): boolean {
    return this.pendingDialogs.size > 0;
  }

  /**
   * A session switch, fork or prompt edit is in flight here.
   *
   * Per-workspace rather than server-wide: two projects have separate runtimes and
   * separate session files, so navigating one has no reason to refuse the same
   * operation in the other.
   */
  replacingSession = false;

  /**
   * When this project last had a client watching it, or a turn running.
   *
   * Touched rather than computed: "unused since" is a fact about attention, and
   * nothing else in here records when attention stopped.
   */
  lastUsedAt = Date.now();

  /**
   * Undefined until the runtime is attached. Deliberately late-bound: the HTTP
   * server starts before the agent (branding must not wait behind model, extension
   * and skill loading), and a workspace's session is built on first open rather
   * than at startup — so "resources exist, runtime does not yet" is a real state,
   * not a construction artefact.
   *
   * Private, and reached through `agent`: a caller that has one of these in hand
   * wants the runtime, not a question about whether there is one.
   */
  private _runtime: AgentRuntime | undefined;

  private readonly options: WorkspaceOptions;
  /** Pending repository re-scan, if a debounce window is open. */
  private repoRescan: NodeJS.Timeout | undefined;
  private stopped = false;
  /** Retired: session and watcher released, project still open. Cleared on rebuild. */
  retired = false;

  private constructor(
    root: string,
    runtime: AgentRuntime | undefined,
    resources: WorkspaceResources,
    options: WorkspaceOptions,
  ) {
    this.root = root;
    this._runtime = runtime;
    this.settings = options.settings;
    this.browserRoot = resources.browserRoot;
    this.writableRoot = resources.writableRoot;
    this.repos = resources.repos;
    this.gitUnavailable = resources.gitUnavailable;
    this.fileWatcher = resources.fileWatcher;
    this.sandboxedTools = resources.sandboxedTools;
    this.options = options;
  }

  /**
   * Build every resource, then the runtime on top of them — the toolset has to
   * exist before the session that is given it.
   */
  static async create(options: WorkspaceOptions): Promise<Workspace> {
    // Identity is the PROJECT directory, never the browser root: a sandbox may be
    // rooted somewhere else entirely, and keying on that would make a workspace
    // answer to a path its sessions are not stored under — SessionManager is keyed
    // by cwd — and let two different projects collide on one sandbox subtree.
    const root = await fs.realpath(options.settings.cwd);
    const resources = await buildResources(options);
    return new Workspace(root, undefined, resources, options);
  }

  /** Resources first, then the session built on top of them. */
  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const workspace = await Workspace.create(options);
    workspace.attachRuntime(await options.createRuntime(options.settings, workspace.sandboxedTools));
    return workspace;
  }

  attachRuntime(runtime: AgentRuntime): void {
    this._runtime = runtime;
  }

  /** Whether the session has been built yet — the `starting` state, seen from here. */
  get started(): boolean {
    return this._runtime !== undefined;
  }

  /**
   * The agent, for the handlers that exist to drive it.
   *
   * Throws rather than returning undefined: reaching this before the runtime is
   * attached means a request was served by a handler that should still have been
   * stubbed out, which is a wiring bug and not a state to code around. Every caller
   * here runs behind the real /ws handler, which is only installed once the runtime
   * is ready.
   */
  get agent(): AgentRuntime {
    if (!this._runtime) throw new Error(`workspace ${this.root} has no runtime yet`);
    return this._runtime;
  }

  /**
   * Whether a turn is running. The one question that gates both retirement and
   * closing: a workspace nobody is watching is the normal state under multi-project,
   * so "unused" can never be allowed to mean "unwatched".
   */
  isBusy(): boolean {
    return this._runtime?.snapshot().isStreaming ?? false;
  }

  /**
   * Rebuild everything rooted at the sandbox root, after it moved. Every watched
   * path was relative to the root that just moved, so the watcher is replaced
   * rather than kept.
   *
   * The runtime is untouched here: rebuilding its toolset is a separate step the
   * caller owns, because it replaces the live session in front of the user.
   */
  async rebuildResources(settings: WorkspaceSettings): Promise<void> {
    // Build first, adopt second. A failure here — a configured root that no longer
    // exists, a toolset that cannot be constructed — must leave the workspace
    // exactly as it was, settings included: the same discipline handleUpdateConfig
    // already applies, so that nothing ever reports a boundary it did not apply.
    const resources = await buildResources({ ...this.options, settings });
    this.settings = settings;
    this.retired = false;
    this.fileWatcher?.close();
    this.browserRoot = resources.browserRoot;
    this.writableRoot = resources.writableRoot;
    this.repos = resources.repos;
    this.gitUnavailable = resources.gitUnavailable;
    this.fileWatcher = resources.fileWatcher;
    this.sandboxedTools = resources.sandboxedTools;
  }

  /**
   * A watched directory changed on disk.
   *
   * The repository set was discovered once, and a workspace whose whole purpose is
   * holding many projects meets `git clone` and `git init` daily - so a set that
   * only refreshes on restart is wrong within the hour. The watcher announces the
   * DIRECTORY that changed, never the file, so a new repository shows up as a
   * change to its parent: there is nothing finer to key on than "something moved",
   * and the answer is to look again.
   *
   * Debounced because a clone writes thousands of files, and the whole scan is
   * bounded and stops at every repository it finds - in the layout that motivates
   * this, a handful of directories.
   */
  noteDirectoryChange(): void {
    if (this.stopped || this.repoRescan !== undefined) return;
    this.repoRescan = setTimeout(() => {
      this.repoRescan = undefined;
      void this.rediscoverRepos();
    }, REPO_RESCAN_DEBOUNCE_MS);
    this.repoRescan.unref?.();
  }

  /**
   * Rebuild the repository set from disk. A failed scan leaves the old set in place.
   *
   * Announces a set that actually changed. Silence would strand a client that was
   * told at connect there was no repository here: it suppresses every git request
   * from then on, so the first repository cloned into an empty workspace would stay
   * invisible however many times the tree changed afterwards.
   */
  async rediscoverRepos(): Promise<void> {
    if (this.stopped) return;
    try {
      const repos = await discoverRepos(this.browserRoot);
      if (this.stopped) return;
      const before = this.repos.map((repo) => repo.toplevel).join("\n");
      this.repos = repos;
      // The reason describes the set it was asked about, so it is asked again whenever
      // that set moves — a stale one would explain a state that has passed
      this.gitUnavailable = await whyGitCannotServe(this.browserRoot, repos);
      if (repos.map((repo) => repo.toplevel).join("\n") !== before) this.options.onRepositoriesChanged?.();
    } catch {
      // A scan that cannot read the tree is not a reason to forget the repositories
    }
  }

  /**
   * Release everything. Idempotent: retirement and an explicit close can race, and
   * closing a watcher twice is not worth a caller-side guard at every call site.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.repoRescan !== undefined) clearTimeout(this.repoRescan);
    this.repoRescan = undefined;
    this.fileWatcher?.close();
    this.fileWatcher = undefined;
    this.renderer.configure(undefined);
    await this._runtime?.dispose();
    this._runtime = undefined;
  }

  /**
   * Release the session and the watcher, but stay open.
   *
   * The difference from `stop()` is what happens next: a retired workspace is
   * rebuilt on its next use, so this must leave it reusable — `stopped` is not set,
   * and the resources come back through the same path a restored project takes.
   */
  async retire(): Promise<void> {
    this.retired = true;
    this.fileWatcher?.close();
    this.fileWatcher = undefined;
    // The renderers close over the session being disposed here, so a retired
    // workspace that kept them would hold its whole runtime alive for nothing.
    // `ensureStarted` reconfigures them when the project is next used.
    this.renderer.configure(undefined);
    // Detach BEFORE awaiting disposal. Awaiting first leaves `started` true for the
    // length of the dispose, and a client opening the project in that window would
    // be handed a snapshot of a runtime about to be thrown away — then every later
    // message would fail, with nothing left to start it again.
    const runtime = this._runtime;
    this._runtime = undefined;
    await runtime?.dispose();
  }
}

interface WorkspaceResources {
  browserRoot: string;
  writableRoot: string | null | undefined;
  /**
   * Every repository serving this workspace, deepest-first. A set rather than one:
   * a project directory may be inside a repository, hold several underneath it, or
   * both, and a path is answered by whichever owns it.
   */
  repos: GitRepo[];
  /** Set only when `repos` is empty: why it is. */
  gitUnavailable: GitUnavailable | undefined;
  fileWatcher: DirectoryWatcher | undefined;
  sandboxedTools: ToolDefinition[] | undefined;
}

/**
 * The document extractors, last, whatever order they were built in.
 *
 * They are the tools published mid-session, when a document enters the conversation. A
 * caching provider re-reads its prompt prefix from the position of whatever changed, so
 * a tool that arrives late belongs late in the list: registered fifth of fourteen,
 * `pdf_extract` kept 9.2% of the prefix; last, everything ahead of it survives.
 *
 * A stable partition rather than a sort — the order of everything else is someone's
 * decision and this is not the place to overturn it.
 */
function documentToolsLast(tools: ToolDefinition[]): ToolDefinition[] {
  const documents = new Set<string>(DOCUMENT_TOOLS);
  return [...tools.filter((tool) => !documents.has(tool.name)), ...tools.filter((tool) => documents.has(tool.name))];
}

async function buildResources(options: WorkspaceOptions): Promise<WorkspaceResources> {
  const { settings, limits } = options;
  const browserRoot = await resolveBrowserRoot(settings);
  const writableRoot = await resolveWritableRoot(settings, browserRoot);
  const repos = await discoverRepos(browserRoot);
  // One probe, always: it separates "no repository here" from "git could not be run at
  // all", and it is the only thing that notices a repository git will refuse to read
  const gitUnavailable = await whyGitCannotServe(browserRoot, repos);
  const sandboxedTools = settings.sandbox
    ? documentToolsLast([
        ...(await createSandboxedTools(
          settings.sandbox,
          limits.pdfMaxBytes,
          limits.docxMaxBytes,
          limits.xlsxMaxBytes,
          limits.pptxMaxBytes,
          limits.structuredExchangeMaxBytes,
        )),
        ...options.unconfinedTools,
      ])
    : undefined;
  const fileWatcher = options.watchFiles
    ? createDirectoryWatcher({ root: browserRoot, onChange: options.onDirectoryChanged })
    : undefined;
  return { browserRoot, writableRoot, repos, gitUnavailable, fileWatcher, sandboxedTools };
}
