import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import App from "./App";
import { UploadError } from "./uploads";

// Mock useAgent to return a controlled state without WebSocket dependency
const mockUseAgent = vi.fn();
vi.mock("./useAgent", () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
}));

vi.mock("./components/PdfViewer", () => ({
  default: ({ path, onLoaded }: { path: string; onLoaded?: (path: string) => void }) => (
    <button type="button" onClick={() => onLoaded?.(path)}>
      Confirm PDF render
    </button>
  ),
}));

// Mock useTheme to avoid matchMedia / message listeners
vi.mock("./theme/useTheme", () => ({
  useTheme: () => ({ theme: "dark" as const, toggle: vi.fn(), setTheme: vi.fn() }),
}));

/** The agent state App reads, with only the fields a test cares about overridden. */
function agentState(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
    workspace: null,
    workspaces: [],
    workspaceLocked: false,
    switching: false,
    authRequired: false,
    branding: { title: "Test App" },
    sessionId: "sess_1",
    model: "anthropic/claude-opus-5",
    thinkingLevel: "off",
    modelSupportsReasoning: false,
    models: [{ provider: "anthropic", id: "claude-opus-5" }],
    commands: [],
    sessions: null,
    sessionSearch: null,
    tree: null,
    isStreaming: false,
    items: [] as ChatItem[],
    workPlan: null,
    outcome: null,
    queue: { steering: [], followUp: [] },
    errors: [],
    contextUsage: null,
    isCompacting: false,
    dialogQueue: [],
    notifications: [],
    statuses: {},
    widgets: {},
    editorPrefill: null,
    fileTree: {},
    directoryRequests: {},
    openFile: null,
    previewRevision: 0,
    credentials: null,
    fileSearch: null,
    extensionPaths: [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    extensionLock: false,
    sandbox: null,
    userSkillPaths: [],
    serverBrowse: null,
    settingsApply: null,
    versions: null,
    gitAvailable: false,
    gitStatus: null,
    gitDiff: null,
    gitLog: null,
    gitShow: null,
    gitFileHistory: null,
    gitFileDiff: null,
    ...overrides,
  };
}

/** Every callback App destructures from useAgent, each a spy. */
function agentApi(state: ReturnType<typeof agentState>) {
  return {
    state,
    authToken: null,
    submitToken: vi.fn(),
    prompt: vi.fn(),
    abort: vi.fn(),
    setModel: vi.fn(),
    setThinking: vi.fn(),
    newSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(),
    renameSession: vi.fn(),
    searchSessions: vi.fn(),
    clearSessionSearch: vi.fn(),
    listTree: vi.fn(),
    navigateTree: vi.fn(),
    forkSession: vi.fn(),
    editPrompt: vi.fn(),
    compact: vi.fn(),
    respondToDialog: vi.fn(),
    dismissNotification: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    uploadFile: vi.fn(async (name: string) => `uploads/${name}`),
    closeFilePreview: vi.fn(),
    searchFiles: vi.fn(),
    clearFileSearch: vi.fn(),
    fetchGitDiff: vi.fn(),
    clearGitDiff: vi.fn(),
    fetchGitLog: vi.fn(),
    fetchGitShow: vi.fn(),
    clearGitShow: vi.fn(),
    fetchGitFileHistory: vi.fn(),
    closeGitFileHistory: vi.fn(),
    fetchGitFileDiff: vi.fn(),
    clearGitFileDiff: vi.fn(),
    setCredential: vi.fn(),
    declareProvider: vi.fn(),
    updateConfig: vi.fn(),
    browseServerDirectory: vi.fn(),
    switchWorkspace: vi.fn(),
    openProject: vi.fn(),
    closeProject: vi.fn(),
    setOutcomeActive: vi.fn(),
    refreshOutcome: vi.fn(),
    closeServerBrowser: vi.fn(),
    openTerminal: vi.fn(),
    sendTerminalInput: vi.fn(),
    getTerminalCwd: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    subscribeTerminal: vi.fn(() => () => {}),
  };
}

beforeEach(() => {
  mockUseAgent.mockReset();
});

describe("Workspace Outcome", () => {
  const workPlan = {
    version: 1 as const,
    id: "p",
    title: "Outcome plan",
    updatedAt: "2026-09-01T00:00:00Z",
    tasks: [{ id: "task", title: "Review task", status: "needs_review" as const, dependsOn: [], resources: [], evidence: [] }],
  };
  const outcome = {
    status: "loaded" as const,
    requestId: "r",
    workspaceRoot: null,
    sessionId: "sess_1",
    outcome: {
      workspaceRoot: "/work",
      sessionId: "sess_1",
      sections: [
        { id: "work-plan", title: "Work Plan", order: 10, availability: "available" as const, entries: [
          { id: "task", source: "Work Plan", title: "Review task", status: "needs_review" as const, target: { kind: "work-plan-task" as const, taskId: "task" } },
        ] },
        { id: "verification", title: "Verification", order: 20, availability: "empty" as const, summary: "Verification not recorded.", entries: [] },
        { id: "changed-files", title: "Changed files", order: 30, availability: "available" as const, entries: [
          { id: "file", source: "Git working tree", title: "src/app.ts", status: "modified" as const, target: { kind: "workspace-diff" as const, path: "src/app.ts" } },
        ] },
      ],
    },
  };

  it("opens the always-available drawer and switches from it to the requested Work Plan task", () => {
    const api = agentApi(agentState({ workPlan, outcome }));
    mockUseAgent.mockReturnValue(api);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Outcome" }));
    expect(screen.getByRole("complementary", { name: "Workspace Outcome" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review task/ }));
    expect(screen.queryByRole("complementary", { name: "Workspace Outcome" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /Review task/ })).toHaveAttribute("aria-selected", "true");
  });

  it("routes changed files through the existing diff-opening path", () => {
    const api = agentApi(agentState({ workPlan, outcome }));
    mockUseAgent.mockReturnValue(api);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Outcome" }));
    fireEvent.click(screen.getByRole("button", { name: /src\/app.ts/ }));
    expect(api.readFile).toHaveBeenCalledWith("src/app.ts");
  });
});

// ---------------------------------------------------------------------------
// TokenGate path — authRequired: true
// ---------------------------------------------------------------------------
describe("App — authRequired", () => {
  beforeEach(() => {
    mockUseAgent.mockReturnValue(agentApi(agentState({ connected: false, authRequired: true, sessionId: "" })));
  });

  it("renders the TokenGate when auth is required", () => {
    render(<App />);
    // TokenGate should show some form of token input
    expect(screen.getByDisplayValue("")).toBeDefined(); // token input
  });
});

// ---------------------------------------------------------------------------
// Onboarding path — credentials without a usable model
// ---------------------------------------------------------------------------
describe("App — onboarding", () => {
  beforeEach(() => {
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({
          branding: { title: "Pi" },
          model: "",
          models: [],
          credentials: { usableModel: false, hasProvider: true, hasKey: false, providers: [] },
        }),
      ),
    );
  });

  it("renders the onboarding screen when no usable model", () => {
    render(<App />);
    // Should not render the main chat
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  });
});

function workspace(root: string) {
  return { root, name: root.split("/").at(-1)!, activity: "idle" as const, needsAttention: false };
}

// openlore: scenario=TheUnsentDraftIsRestored spec=multi-project-workspaces
describe("TheUnsentDraftIsRestored", () => {
  it("restores a project's draft after a round trip through another project", () => {
    const alpha = workspace("/srv/alpha");
    const beta = workspace("/srv/beta");
    let api = agentApi(agentState({ workspace: alpha, workspaces: [alpha, beta] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "alpha draft" } });
    api = agentApi(agentState({ workspace: beta, workspaces: [alpha, beta] }));
    view.rerender(<App />);
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "beta draft" } });
    api = agentApi(agentState({ workspace: alpha, workspaces: [alpha, beta] }));
    view.rerender(<App />);

    expect(screen.getByPlaceholderText(/message/i)).toHaveValue("alpha draft");
  });
});

// openlore: scenario=DraftsDoNotFollowTheClient spec=multi-project-workspaces
describe("DraftsDoNotFollowTheClient", () => {
  it("shows an empty composer when a project with no draft is selected", () => {
    const alpha = workspace("/srv/alpha");
    const beta = workspace("/srv/beta");
    let api = agentApi(agentState({ workspace: alpha, workspaces: [alpha, beta] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "alpha only" } });

    api = agentApi(agentState({ workspace: beta, workspaces: [alpha, beta] }));
    view.rerender(<App />);

    expect(screen.getByPlaceholderText(/message/i)).toHaveValue("");
  });
});

// ---------------------------------------------------------------------------
// Session analysis — the conversation side of the panel: anchors and jumps.
// The panel's own content is covered in components/SessionAnalysis.test.tsx;
// what matters here is that the two agree about where an item lives.
// ---------------------------------------------------------------------------
describe("App — session analysis", () => {
  const usage = (cost?: number): TurnUsage => ({
    input: 1000,
    output: 200,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1200,
    ...(cost === undefined ? {} : { cost }),
  });

  const items: ChatItem[] = [
    { kind: "user", text: "read the config" },
    // A turn that only called tools: nothing to show, but it is a turn and it
    // carries usage, so the analysis can point at it.
    { kind: "assistant", blocks: [], usage: usage(0.01) },
    { kind: "tool", toolCallId: "call-1", toolName: "read", args: { path: "a.ts" }, output: "contents" },
    { kind: "assistant", blocks: [{ type: "text", text: "done" }], usage: usage(0.02) },
  ];

  function renderApp(hideTools = false) {
    localStorage.setItem("pi-outpost:hide-tools", hideTools ? "1" : "0");
    mockUseAgent.mockReturnValue(agentApi(agentState({ items })));
    return render(<App />);
  }

  function anchor(index: number) {
    return document.querySelector(`[data-item-index="${index}"]`);
  }

  function openAnalysis() {
    fireEvent.click(screen.getByTitle(/turns? ·/));
  }

  beforeEach(() => {
    // jsdom has no layout, so scrollIntoView is not implemented.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("anchors every item the analysis can point at, including tool-only turns", () => {
    renderApp();
    expect(anchor(0)).not.toBeNull(); // user message
    expect(anchor(1)).not.toBeNull(); // tool-only assistant turn: nothing rendered, still anchored
    expect(anchor(2)).not.toBeNull(); // tool card
    expect(anchor(3)).not.toBeNull(); // assistant message
  });

  it("opens and closes the analysis from the usage figure", () => {
    renderApp();
    expect(screen.queryByRole("complementary", { name: "Session analysis" })).toBeNull();

    openAnalysis();
    expect(screen.getByRole("complementary", { name: "Session analysis" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Close session analysis"));
    expect(screen.queryByRole("complementary", { name: "Session analysis" })).toBeNull();
  });

  it("scrolls to the turn behind a chart point and marks it", () => {
    renderApp();
    openAnalysis();
    fireEvent.click(screen.getAllByRole("button", { name: /^Turn 2:/ })[0]);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(anchor(3)?.className).toContain("ring-2");
    expect(anchor(0)?.className).not.toContain("ring-2");
  });

  it("scrolls to a turn that shows nothing without marking a neighbour instead", () => {
    // A tool-only turn has no card of its own; its anchor carries no mark, and
    // marking the message next to it would point at the wrong turn.
    renderApp();
    openAnalysis();
    fireEvent.click(screen.getAllByRole("button", { name: /^Turn 1:/ })[0]);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(anchor(3)?.className).not.toContain("ring-2");
    expect(anchor(0)?.className).not.toContain("ring-2");
  });

  it("reveals a hidden tool call before scrolling to it", () => {
    renderApp(true);
    expect(anchor(2)).toBeNull(); // tool cards filtered out of the conversation

    openAnalysis();
    fireEvent.click(screen.getByRole("button", { name: /Jump to the read call/ }));

    expect(anchor(2)).not.toBeNull();
    expect(anchor(2)?.className).toContain("ring-2");
  });

  it("reports the same token total in the bar and in the panel", () => {
    renderApp();
    expect(screen.getByTitle(/2 turns ·/).textContent).toContain("2k tok");

    openAnalysis();
    const heading = screen.getByText("tokens", { selector: "h3" });
    expect(within(heading.closest("section") as HTMLElement).getByLabelText("total: 2k")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Wiring: App holds the state the panes share, so these are the handovers
// between them rather than any single component's behaviour.
// ---------------------------------------------------------------------------
/** The sidebar toggle, told apart from the composer's "Attach files" by its glyph. */
const sidebarToggle = () => screen.getByRole("button", { name: /[◨◧]\s*files/ });

describe("App — panes and handovers", () => {
  beforeEach(() => localStorage.removeItem("pi-outpost.files-sidebar-width.v1"));

  function mount(overrides: Record<string, unknown> = {}) {
    const api = agentApi(agentState(overrides));
    mockUseAgent.mockReturnValue(api);
    const view = render(<App />);
    return { api, ...view };
  }

  it("opens and closes the file sidebar", () => {
    mount();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
    fireEvent.click(sidebarToggle());
    expect(screen.getByText("Files")).toBeInTheDocument();
    fireEvent.click(sidebarToggle());
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });

  it("keeps the main column flexible while the Files sidebar is resized", () => {
    mount();
    fireEvent.click(sidebarToggle());
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });
    const mainColumn = sidebar.nextElementSibling as HTMLElement;

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 288, button: 0, isPrimary: true });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 416 });

    expect(sidebar).toHaveStyle({ width: "416px" });
    expect(mainColumn.className).toMatch(/\bmin-w-0\b/);
    expect(mainColumn.className).toMatch(/\bflex-1\b/);
  });

  it("shows the file viewer over the conversation when a file is open", () => {
    mount({ openFile: { status: "loaded", path: "src/main.ts", content: "const a = 1;", size: 12, mtimeMs: 1 } });
    expect(screen.getByRole("button", { name: "Close file viewer" })).toBeInTheDocument();
  });

  // openlore: scenario=TheChipFollowsADirectoryToo spec=git
  it("moves the branch chip when the user walks into another project's directory", () => {
    // The gap a component test could not see: GitMenu was right, and App fed it the
    // open FILE, so clicking a project's folder moved nothing.
    mount({
      gitAvailable: true,
      fileTree: {
        "": [
          { name: "projA", type: "directory" },
          { name: "projB", type: "directory" },
        ],
      },
      gitStatus: {
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 0, behind: 0 },
        ],
        files: {},
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /[◨◧]\s*files/ }));

    const chip = () => screen.getByRole("button", { name: /⎇/ });
    expect(chip()).toHaveTextContent("—");

    fireEvent.click(screen.getByRole("button", { name: /^[▸▾]\s*projB\s*\d*$/ }));
    expect(chip()).toHaveTextContent("release");

    fireEvent.click(screen.getByRole("button", { name: /^[▸▾]\s*projA\s*\d*$/ }));
    expect(chip()).toHaveTextContent("main");
  });

  it("offers no history for a file under no repository, though the workspace has git", () => {
    // A directory of projects: two repositories, and a loose file beside them. The
    // workspace has git; this file has no history, and the affordance would 404.
    mount({
      gitAvailable: true,
      gitStatus: {
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 0, behind: 0 },
        ],
        files: {},
      },
      openFile: { status: "loaded", path: "notes.md", content: "x", size: 1, mtimeMs: 1 },
    });
    expect(screen.queryByRole("button", { name: /history/ })).not.toBeInTheDocument();
  });

  it("offers history for a file inside one of several repositories", () => {
    const { api } = mount({
      gitAvailable: true,
      gitStatus: {
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 0, behind: 0 },
        ],
        files: {},
      },
      openFile: { status: "loaded", path: "projB/src/main.ts", content: "x", size: 1, mtimeMs: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: /history/ }));
    expect(api.fetchGitFileHistory).toHaveBeenCalledWith("projB/src/main.ts");
  });

  it("asks for a file's history from the viewer", () => {
    const { api } = mount({
      gitAvailable: true,
      gitStatus: { repos: [{ repo: "", branch: "main", ahead: 0, behind: 0 }], files: {} },
      openFile: { status: "loaded", path: "src/main.ts", content: "x", size: 1, mtimeMs: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: /history/ }));
    expect(api.fetchGitFileHistory).toHaveBeenCalledWith("src/main.ts");
  });

  it("shows the history pane once the answer arrives", () => {
    mount({
      gitAvailable: true,
      gitStatus: { repos: [{ repo: "", branch: "main", ahead: 0, behind: 0 }], files: {} },
      openFile: { status: "loaded", path: "src/main.ts", content: "x", size: 1, mtimeMs: 1 },
      gitFileHistory: { path: "src/main.ts", status: "loaded", entries: [], requestId: "r1" },
    });
    expect(screen.getByRole("button", { name: "Close file history" })).toBeInTheDocument();
    expect(screen.getByText("No commits touch this file yet.")).toBeInTheDocument();
  });

  it("surfaces errors from the agent", () => {
    mount({ errors: ["git: not a repository"] });
    expect(screen.getByText(/not a repository/)).toBeInTheDocument();
  });

  it("shows an extension notification", () => {
    mount({ notifications: [{ id: "n1", message: "OmniRoute ready", type: "info" }] });
    expect(screen.getByText("OmniRoute ready")).toBeInTheDocument();
  });

  it("queues an extension dialog for an answer", () => {
    mount({ dialogQueue: [{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Proceed?", message: "Really?" }] });
    expect(screen.getByText("Proceed?")).toBeInTheDocument();
  });

  it("remembers the tool-noise filter across mounts", () => {
    localStorage.clear();
    const first = mount();
    fireEvent.click(screen.getByRole("button", { name: /tools/ }));
    first.unmount();

    mount();
    expect(screen.getByRole("button", { name: /tools/ })).toHaveAttribute("aria-pressed", "true");
    localStorage.clear();
  });
});

describe("App — attachments", () => {
  function mount(overrides: Record<string, unknown> = {}) {
    const api = agentApi(agentState(overrides));
    mockUseAgent.mockReturnValue(api);
    const view = render(<App />);
    return { api, ...view };
  }

  it("references a file pinned in the tree, and drops it when unpinned", () => {
    mount({ fileTree: { "": [{ name: "readme.md", type: "file" }] } });
    fireEvent.click(sidebarToggle());
    const pin = screen.getByRole("button", { name: "Reference readme.md in the prompt" });

    fireEvent.click(pin);
    expect(screen.getByRole("button", { name: "Remove readme.md in the prompt" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Remove readme.md in the prompt" }));
    expect(screen.getByRole("button", { name: "Reference readme.md in the prompt" })).toHaveAttribute("aria-pressed", "false");
  });

  it.each(["docs/report.docx", "sheets/budget.xlsx"])(
    "automatically references a tool-readable binary file: %s",
    async (path) => {
      const { api } = mount({
        openFile: { status: "error", path, message: "Binary file — preview not supported" },
      });

      await waitFor(() =>
        expect(screen.getByTitle(`${path} — sent as a reference; the agent reads the file itself`)).toBeInTheDocument(),
      );

      const box = screen.getByRole("textbox");
      fireEvent.change(box, { target: { value: "summarize it" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(api.prompt).toHaveBeenCalledWith(expect.stringContaining(`@${path}`), undefined);
    },
  );

  it("does not attach an unsupported binary file", async () => {
    mount({ openFile: { status: "error", path: "archive.zip", message: "Binary file — preview not supported" } });

    await waitFor(() => expect(screen.getByText("Binary file — preview not supported")).toBeInTheDocument());
    expect(screen.queryByTitle(/archive\.zip — sent as a reference/)).not.toBeInTheDocument();
  });

  it("drops stale preview bytes when an image refresh fails", async () => {
    const originalFetch = globalThis.fetch;
    const fetchPreview = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce({ ok: false, headers: { get: () => null } });
    globalThis.fetch = fetchPreview;
    try {
      const path = "plot.png";
      const firstApi = agentApi(
        agentState({
          openFile: { status: "error", path, message: "Binary file — preview not supported" },
          previewRevision: 1,
        }),
      );
      mockUseAgent.mockReturnValue(firstApi);
      const view = render(<App />);
      fireEvent.load(screen.getByRole("img", { name: path }));
      await waitFor(() => expect(within(screen.getByRole("contentinfo")).getByText(path)).toBeInTheDocument());

      const refreshedApi = agentApi(
        agentState({
          openFile: { status: "error", path, message: "Binary file — preview not supported" },
          previewRevision: 2,
        }),
      );
      mockUseAgent.mockReturnValue(refreshedApi);
      view.rerender(<App />);

      await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(screen.getByRole("contentinfo")).queryByText(path)).not.toBeInTheDocument());
      const box = screen.getByRole("textbox");
      fireEvent.change(box, { target: { value: "describe it" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(refreshedApi.prompt).toHaveBeenCalledWith("describe it", undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("requires the current PDF revision to render before attaching it", async () => {
    const path = "report.pdf";
    const firstApi = agentApi(
      agentState({
        openFile: { status: "error", path, message: "Binary file — preview not supported" },
        previewRevision: 1,
      }),
    );
    mockUseAgent.mockReturnValue(firstApi);
    const view = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm PDF render" }));
    await waitFor(() => expect(within(screen.getByRole("contentinfo")).getByText(path)).toBeInTheDocument());

    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({
          openFile: { status: "error", path, message: "Binary file — preview not supported" },
          previewRevision: 2,
        }),
      ),
    );
    view.rerender(<App />);

    await waitFor(() => expect(within(screen.getByRole("contentinfo")).queryByText(path)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm PDF render" }));
    await waitFor(() => expect(within(screen.getByRole("contentinfo")).getByText(path)).toBeInTheDocument());
  });

  it("sends the prompt and clears what was attached to it", () => {
    const { api } = mount({ fileTree: { "": [{ name: "readme.md", type: "file" }] } });
    fireEvent.click(sidebarToggle());
    fireEvent.click(screen.getByRole("button", { name: "Reference readme.md in the prompt" }));

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "what is this?" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(api.prompt).toHaveBeenCalledWith(expect.stringContaining("@readme.md"), undefined);
    expect(screen.getByRole("button", { name: "Reference readme.md in the prompt" })).toHaveAttribute("aria-pressed", "false");
  });

  it("closes the viewer on send, since the user wants the conversation back", () => {
    const { api } = mount({ openFile: { status: "loaded", path: "src/main.ts", content: "x", size: 1, mtimeMs: 1 } });
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "carry on" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(api.closeFilePreview).toHaveBeenCalled();
  });

  it("keeps the viewer open on send when it holds unsaved edits", () => {
    const { api } = mount({
      openFile: { status: "loaded", path: "src/main.ts", content: "x", size: 1, mtimeMs: 1 },
      sandbox: { root: "/w", allowWrite: true, allowBash: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "✎ edit" }));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "edited" } });

    const composer = screen.getAllByRole("textbox").at(-1)!;
    fireEvent.change(composer, { target: { value: "carry on" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(api.closeFilePreview).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drag and drop, and the callbacks the panes hand back. These are the parts of
// App that no single component owns.
// ---------------------------------------------------------------------------
describe("App — dropping files", () => {
  function mount(overrides: Record<string, unknown> = {}) {
    const api = agentApi(agentState(overrides));
    mockUseAgent.mockReturnValue(api);
    const view = render(<App />);
    return { api, ...view };
  }

  /** A drag carrying the given payload kinds, as the browser reports them. */
  const dataTransfer = (types: string[], files: File[] = []) => ({ types, files });
  const dropZone = () => document.querySelector(".relative.flex.h-full")!;

  it("invites a drop only once files are actually being dragged", () => {
    mount();
    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["text/plain"]) });
    expect(screen.queryByText(/Drop files to attach/)).not.toBeInTheDocument();

    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["Files"]) });
    expect(screen.getByText(/Drop files to attach/)).toBeInTheDocument();
  });

  it("keeps the invitation up while the pointer crosses child elements", () => {
    // dragenter/dragleave fire for every child crossed, so this counts rather than toggles
    mount();
    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["Files"]) });
    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["Files"]) });
    fireEvent.dragLeave(dropZone());
    expect(screen.getByText(/Drop files to attach/)).toBeInTheDocument();

    fireEvent.dragLeave(dropZone());
    expect(screen.queryByText(/Drop files to attach/)).not.toBeInTheDocument();
  });

  it("does not fall below zero when a stray dragleave arrives first", () => {
    mount();
    fireEvent.dragLeave(dropZone());
    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["Files"]) });
    expect(screen.getByText(/Drop files to attach/)).toBeInTheDocument();
  });

  it("takes the invitation down once the files land", async () => {
    mount();
    fireEvent.dragEnter(dropZone(), { dataTransfer: dataTransfer(["Files"]) });
    const dropped = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [dropped]) });
    await waitFor(() => expect(screen.queryByText(/Drop files to attach/)).not.toBeInTheDocument());
  });

  it("attaches a dropped text file to the next prompt", async () => {
    mount();
    const dropped = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [dropped]) });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
  });

  it("says why a file it cannot take was refused", async () => {
    mount();
    const huge = new File([new Uint8Array(600 * 1024)], "big.txt", { type: "text/plain" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [huge]) });
    await waitFor(() => expect(screen.getByText(/big\.txt/)).toBeInTheDocument());
  });

  /** The composer's hidden file input — what the attach button clicks. */
  const attachInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  it("copies a dropped PDF into the workspace and references the path it wrote", async () => {
    const { api } = mount();
    const dropped = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });

    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [dropped]) });

    await waitFor(() => expect(screen.getByText("uploads/report.pdf")).toBeInTheDocument());
    expect(api.uploadFile).toHaveBeenCalledWith("report.pdf", expect.any(String));
  });

  it("produces the same attachment from the attach button as from a drop", async () => {
    const { api, unmount } = mount();
    const file = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });

    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [file]) });
    await waitFor(() => expect(screen.getByText("uploads/report.pdf")).toBeInTheDocument());
    const droppedTitle = screen.getByText("uploads/report.pdf").closest("span")?.getAttribute("title");
    const droppedUploadArgs = api.uploadFile.mock.calls[0];
    unmount();

    const second = mount();
    fireEvent.change(attachInput(), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("uploads/report.pdf")).toBeInTheDocument());

    expect(screen.getByText("uploads/report.pdf").closest("span")?.getAttribute("title")).toBe(droppedTitle);
    expect(second.api.uploadFile.mock.calls[0]).toEqual(droppedUploadArgs);
  });

  it("shows a pending chip and blocks sending until the upload settles", async () => {
    // The deferred is built before the mock is installed: the upload only starts
    // once the file has been read, so capturing `resolve` from inside the mock
    // would race the assertion below.
    let release: (path: string) => void = () => {};
    const held = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { api } = mount();
    api.uploadFile.mockReturnValue(held);
    const dropped = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });

    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [dropped]) });

    await waitFor(() => expect(document.querySelector('[data-pending-upload="report.pdf"]')).toBeInTheDocument());
    expect(screen.getByLabelText("Send message")).toBeDisabled();

    await act(async () => {
      release("uploads/report.pdf");
    });
    await waitFor(() => expect(document.querySelector('[data-pending-upload="report.pdf"]')).not.toBeInTheDocument());
    expect(screen.getByText("uploads/report.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeEnabled();
  });

  it("keeps both refusals when two drops overlap", async () => {
    // attachFiles spans a round trip now, so two drops can be in flight at once.
    // A plain replace would let the second one's result erase the first's error
    // before anyone read it.
    let release: (path: string) => void = () => {};
    const held = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { api } = mount();
    api.uploadFile.mockReturnValueOnce(held);

    // This drop stays in flight, holding the wave open across the two below
    const slow = new File(["%PDF-1.7"], "slow.pdf", { type: "application/pdf" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [slow]) });
    await waitFor(() => expect(document.querySelector('[data-pending-upload="slow.pdf"]')).toBeInTheDocument());

    const refusedFirst = new File([new Uint8Array(900 * 1024)], "first.zip", { type: "application/zip" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [refusedFirst]) });
    await waitFor(() => expect(screen.getByText(/first\.zip/)).toBeInTheDocument());

    const refusedSecond = new File([new Uint8Array(900 * 1024)], "second.zip", { type: "application/zip" });
    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [refusedSecond]) });
    await waitFor(() => expect(screen.getByText(/second\.zip/)).toBeInTheDocument());

    expect(screen.getByText(/first\.zip/)).toBeInTheDocument();
    await act(async () => {
      release("uploads/slow.pdf");
    });
  });

  it("attaches a pasted image without copying it into the workspace", async () => {
    const { api } = mount();
    const pasted = new File(["fake-png"], "shot.png", { type: "image/png" });

    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [pasted]) });

    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pending-upload]')).not.toBeInTheDocument();
  });

  it("leaves no attachment and clears the pending chip when an upload fails", async () => {
    const { api } = mount();
    api.uploadFile.mockRejectedValue(new UploadError("the workspace is read-only", "denied"));
    const dropped = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });

    fireEvent.drop(dropZone(), { dataTransfer: dataTransfer(["Files"], [dropped]) });

    await waitFor(() => expect(screen.getByText(/read-only/)).toBeInTheDocument());
    expect(document.querySelector('[data-pending-upload="report.pdf"]')).not.toBeInTheDocument();
    expect(screen.queryByText("uploads/report.pdf")).not.toBeInTheDocument();
    // Still disabled only because the draft is empty — not because a failed upload
    // is being waited on forever
    expect(screen.getByLabelText("Send message")).toHaveAttribute("title", "send");
  });
});

describe("App — model bar and tree", () => {
  function mount(overrides: Record<string, unknown> = {}) {
    const api = agentApi(agentState(overrides));
    mockUseAgent.mockReturnValue(api);
    render(<App />);
    return api;
  }

  it("changes the model from the bar", () => {
    const api = mount({ models: [{ provider: "anthropic", id: "opus", name: "Opus", reasoning: true }] });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "anthropic/opus" } });
    expect(api.setModel).toHaveBeenCalledWith("anthropic", "opus");
  });

  it("asks for the tree when the menu opens, and navigates from it", () => {
    const api = mount({ tree: [{ entryId: "e1", text: "first turn", onPath: true, children: [] }] });
    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(api.listTree).toHaveBeenCalled();

    fireEvent.click(screen.getByText("first turn"));
    expect(api.navigateTree).toHaveBeenCalledWith("e1");
  });

  it("forks a session from the tree", () => {
    const api = mount({ tree: [{ entryId: "e1", text: "first turn", onPath: true, children: [] }] });
    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    fireEvent.click(screen.getByRole("button", { name: /fork/ }));
    expect(api.forkSession).toHaveBeenCalledWith("e1");
  });

  it("opens a file from the tree straight onto its diff", () => {
    const api = mount({
      fileTree: { "": [{ name: "readme.md", type: "file" }] },
      gitStatus: { repos: [{ repo: "", branch: "main", ahead: 0, behind: 0 }], files: { "readme.md": "modified" } },
      gitAvailable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /[◨◧]\s*files/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show diff of readme.md" }));
    expect(api.readFile).toHaveBeenCalledWith("readme.md");
  });

  it("shows the steering and follow-up queue", () => {
    mount({ queue: { steering: ["stop that"], followUp: ["then this"] } });
    expect(screen.getByText(/stop that/)).toBeInTheDocument();
    expect(screen.getByText(/then this/)).toBeInTheDocument();
  });

  it("shows an extension's widget above the editor", () => {
    mount({ widgets: { w1: { lines: ["build: passing"], placement: "aboveEditor" } } });
    expect(screen.getByText("build: passing")).toBeInTheDocument();
  });
});

// openlore: scenario=OpeningADirectoryFromThePicker spec=multi-project-workspaces
describe("choosing a project directory", () => {
  const alpha = workspace("/srv/alpha");

  function openThePicker() {
    const api = agentApi(
      agentState({
        workspace: alpha,
        workspaces: [alpha],
        serverBrowse: { status: "loaded", path: "/srv/beta", parent: "/srv", entries: [], requestId: "r1" },
      }),
    );
    mockUseAgent.mockImplementation(() => api);
    render(<App />);
    // Through the selector, which names the project whether one is open or several
    // — there is no separate single-project control to click any more.
    fireEvent.click(screen.getByTitle(/^Project:/));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open a project/ }));
    return api;
  }

  it("shows the picker and starts the server walk at the top", () => {
    const api = openThePicker();

    // The empty path is what asks the server where it would start.
    expect(api.browseServerDirectory).toHaveBeenCalledWith("");
    expect(screen.getByTestId("server-path-picker")).toBeInTheDocument();
  });

  it("opens the directory it was left on, and releases the browser with it", () => {
    const api = openThePicker();

    fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));

    expect(api.openProject).toHaveBeenCalledWith("/srv/beta");
    // The listing is server state: leaving it behind would show a stale walk the
    // next time the picker opens.
    expect(api.closeServerBrowser).toHaveBeenCalled();
    expect(screen.queryByTestId("server-path-picker")).not.toBeInTheDocument();
  });

  it("opens nothing when the picker is cancelled", () => {
    const api = openThePicker();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.openProject).not.toHaveBeenCalled();
    expect(api.closeServerBrowser).toHaveBeenCalled();
    expect(screen.queryByTestId("server-path-picker")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Embed workspace controls — which affordance a mounted widget presents, and
// which of them are refusals rather than choices.
// ---------------------------------------------------------------------------
function embedded(overrides: Record<string, unknown> = {}) {
  const alpha = workspace("/srv/alpha");
  const beta = workspace("/srv/beta");
  const api = agentApi(
    agentState({
      workspace: alpha,
      workspaces: [alpha, beta],
      // An embed paints nothing until branding has settled, so a widget never
      // flashes the default brand before the host's.
      brandingReady: true,
      sandbox: { root: "/srv/alpha", allowWrite: true, allowBash: false, writableRoot: "/srv/alpha/out" },
      serverBrowse: { status: "loaded", path: "/srv/gamma", parent: "/srv", entries: [], requestId: "r1" },
      ...overrides,
    }),
  );
  mockUseAgent.mockImplementation(() => api);
  const view = render(<App rootElement={document.createElement("div")} />);
  return { ...view, api };
}

// openlore: scenario=SettingsModeKeepsProjectControlsHidden spec=embed
describe("an embed under the default policy", () => {
  it("offers neither a project selector nor a root chooser", () => {
    embedded();

    // What every widget showed before the setting existed, and what a server
    // that says nothing still means.
    expect(screen.queryByTitle(/^Project:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sandbox root/ })).not.toBeInTheDocument();
    // Settings stays reachable in every mode — that is where the root lives here.
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("leaves the standalone app's project selector alone", () => {
    const alpha = workspace("/srv/alpha");
    const beta = workspace("/srv/beta");
    mockUseAgent.mockImplementation(() => agentApi(agentState({ workspace: alpha, workspaces: [alpha, beta] })));
    render(<App />);

    // The policy is about mounted widgets. A standalone client on the same server
    // keeps the controls it has always had.
    expect(screen.getByTitle(/^Project:/)).toBeInTheDocument();
  });
});

// openlore: scenario=RootModeReplacesTheSingleSandboxRoot spec=embed
describe("an embed in root mode", () => {
  it("replaces the sandbox root, preserving every other sandbox setting", () => {
    const { api } = embedded({ embedWorkspaceControls: "root" });

    fireEvent.click(screen.getByRole("button", { name: /Sandbox root/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this directory" }));

    // The whole current sandbox with only the root replaced: dropping a flag here
    // would quietly widen or narrow what the agent may do.
    expect(api.updateConfig).toHaveBeenCalledWith({
      sandbox: { root: "/srv/gamma", allowWrite: true, allowBash: false, writableRoot: "/srv/alpha/out" },
    });
    // A root replacement is not an open: no second project is created.
    expect(api.openProject).not.toHaveBeenCalled();
  });

  it("offers no project selector beside the root chooser", () => {
    embedded({ embedWorkspaceControls: "root" });

    expect(screen.getByRole("button", { name: /Sandbox root/ })).toBeInTheDocument();
    expect(screen.queryByTitle(/^Project:/)).not.toBeInTheDocument();
  });
});

// openlore: scenario=ProjectsModeOffersProjectControls spec=embed
// openlore: scenario=WorkspaceLockOverridesProjectsMode spec=embed
describe("an embed in projects mode", () => {
  it("offers the project controls the standalone app has", () => {
    embedded({ embedWorkspaceControls: "projects" });

    expect(screen.getByTitle(/^Project:/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sandbox root/ })).not.toBeInTheDocument();
  });

  it("offers nothing once the server is workspace-locked", () => {
    embedded({ embedWorkspaceControls: "projects", workspaceLocked: true });

    // The lock is the server's answer and the policy cannot argue with it: a
    // presentation choice may only narrow what the server already allows.
    expect(screen.queryByTitle(/^Project:/)).not.toBeInTheDocument();
  });
});

describe("one listing, one picker", () => {
  it("closes the project picker when the sandbox-root chooser opens", () => {
    const { api } = embedded({ embedWorkspaceControls: "projects" });
    fireEvent.click(screen.getByTitle(/^Project:/));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open a project/ }));
    expect(screen.getByTestId("server-path-picker")).toBeInTheDocument();

    // Settings owns the same server-browse listing; opening its picker has to
    // take the project one down rather than stack a second over the same walk.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));

    expect(screen.getAllByTestId("server-path-picker")).toHaveLength(1);
    expect(api.closeServerBrowser).not.toHaveBeenCalled();
  });

  it("keeps the listing a control is walking when the pointer lands elsewhere", () => {
    const { api } = embedded({ embedWorkspaceControls: "root" });
    fireEvent.click(screen.getByRole("button", { name: /Sandbox root/ }));

    // Every menu in the header watches for a press outside itself. One of them
    // released the shared listing on every such press — including the first click
    // inside another control's picker, which emptied it before it was used.
    fireEvent.mouseDown(screen.getByTestId("server-path-picker"));

    expect(screen.getByTestId("server-path-picker")).toBeInTheDocument();
    expect(api.closeServerBrowser).not.toHaveBeenCalled();
  });

  it("hands the listing to Settings rather than taking it away from both", () => {
    const { api } = embedded({ embedWorkspaceControls: "root" });
    fireEvent.click(screen.getByRole("button", { name: /Sandbox root/ }));
    expect(screen.getByTestId("server-path-picker")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse for sandbox root" }));

    // One picker, and it is a usable one: the control that yields must not
    // release the listing, or it discards the request the new owner just made
    // and leaves it showing nothing at all.
    expect(screen.getAllByTestId("server-path-picker")).toHaveLength(1);
    expect(api.closeServerBrowser).not.toHaveBeenCalled();
    expect(api.browseServerDirectory).toHaveBeenLastCalledWith("/srv/alpha");
  });
});

// ---------------------------------------------------------------------------
// conversation-scroll-navigation — the return-to-latest control
// ---------------------------------------------------------------------------
describe("ReturnToLatest", () => {
  const CONTROL = "Scroll to the latest message";

  /**
   * Gives the conversation scroller a layout jsdom will not.
   *
   * jsdom implements none, so `scrollHeight`, `clientHeight` and `scrollTop` all
   * read 0 and the near-bottom expression is `0 < 120` — always true. A test that
   * skipped this would find the control never rendered and would pass its
   * "hidden at the bottom" assertion for entirely the wrong reason. Every test
   * below therefore drives both directions.
   */
  function layout(main: HTMLElement, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    for (const [name, value] of Object.entries(geometry)) {
      Object.defineProperty(main, name, { value, writable: true, configurable: true });
    }
  }

  const scroller = () => document.querySelector("main")!;

  /** Puts the reader far above the end and lets the app notice. */
  function scrollUp(main = scroller()) {
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 0 });
    fireEvent.scroll(main);
  }

  /** Puts the reader back inside the near-bottom region and lets the app notice. */
  function scrollDown(main = scroller()) {
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
    fireEvent.scroll(main);
  }

  const control = () => screen.queryByRole("button", { name: CONTROL });

  /** Where the transcript's bottom anchor lives: the scroller's last leaf. */
  function bottomAnchor() {
    const inner = scroller().firstElementChild!;
    return inner.lastElementChild!;
  }

  let scrolledInto: Element[];

  function mount(overrides: Record<string, unknown> = {}) {
    const api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[], ...overrides }));
    mockUseAgent.mockReturnValue(api);
    return { api, view: render(<App />) };
  }

  beforeEach(() => {
    scrolledInto = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledInto.push(this);
    });
  });

  // openlore: scenario=HiddenAtBottom spec=conversation-scroll-navigation
  it("shows nothing while the reader is already at the bottom", () => {
    mount();
    scrollDown();
    expect(control()).toBeNull();
  });

  // openlore: scenario=AppearsOnScrollUp spec=conversation-scroll-navigation
  it("appears once the reader scrolls out of the near-bottom region", () => {
    mount();
    scrollDown();
    expect(control()).toBeNull();

    scrollUp();
    expect(control()).toBeInTheDocument();
  });

  // openlore: scenario=HidesOnScrollBackDown spec=conversation-scroll-navigation
  it("disappears once the reader scrolls back into it", () => {
    mount();
    scrollUp();
    expect(control()).toBeInTheDocument();

    scrollDown();
    expect(control()).toBeNull();
  });

  // openlore: scenario=NotShownWhenNothingToScroll spec=conversation-scroll-navigation
  it("stays away when the conversation is shorter than the viewport", () => {
    mount();
    const main = scroller();
    layout(main, { scrollHeight: 400, clientHeight: 400, scrollTop: 0 });
    fireEvent.scroll(main);
    expect(control()).toBeNull();
  });

  // openlore: scenario=AbsentFromTreeWhenHidden spec=conversation-scroll-navigation
  it("exposes no button at all to assistive technology while hidden", () => {
    mount();
    scrollUp();
    expect(screen.getAllByRole("button", { name: CONTROL })).toHaveLength(1);

    scrollDown();
    // Not merely invisible: gone from the tree, so it is never a focus stop.
    expect(screen.queryAllByRole("button", { name: CONTROL })).toHaveLength(0);
  });

  // openlore: scenario=NamedForAssistiveTech spec=conversation-scroll-navigation
  it("is a named button, not an unlabelled decoration", () => {
    mount();
    scrollUp();
    const button = screen.getByRole("button", { name: CONTROL });
    // A native button is what makes Enter and Space work; the browser test
    // presses them for real (e2e/app.spec.ts).
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toBeDisabled();
  });

  // openlore: scenario=ScrollsToEnd spec=conversation-scroll-navigation
  it("scrolls to the end of the transcript when activated", () => {
    mount();
    scrollUp();
    scrolledInto = [];

    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    expect(scrolledInto).toContain(bottomAnchor());
  });

  // openlore: scenario=ReducedMotionJumps spec=conversation-scroll-navigation
  it("jumps rather than animates for a reader who asked for less motion", () => {
    // `behavior: "smooth"` is not softened by the preference the way a CSS
    // transition is: the browser animates it either way unless asked not to.
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce"), media: query }));
    vi.stubGlobal("matchMedia", matchMedia);
    const behaviors: (string | undefined)[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element, options?: ScrollIntoViewOptions | boolean) {
      scrolledInto.push(this);
      behaviors.push(typeof options === "object" ? options.behavior : undefined);
    });

    mount();
    scrollUp();
    behaviors.length = 0;
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    expect(behaviors).toContain("auto");
    expect(behaviors).not.toContain("smooth");
    vi.unstubAllGlobals();
  });

  it("animates for everyone else", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query })));
    const behaviors: (string | undefined)[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element, options?: ScrollIntoViewOptions | boolean) {
      behaviors.push(typeof options === "object" ? options.behavior : undefined);
    });

    mount();
    scrollUp();
    behaviors.length = 0;
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    expect(behaviors).toContain("smooth");
    vi.unstubAllGlobals();
  });

  // openlore: scenario=HidesAfterActivation spec=conversation-scroll-navigation
  it("takes itself away once it has done its job", () => {
    mount();
    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    // Not waiting for the smooth scroll to settle: a reduced-motion jump may
    // never emit the settling event that would otherwise hide it.
    expect(control()).toBeNull();
  });

  // openlore: scenario=ResumesAutoScroll spec=conversation-scroll-navigation
  it("puts the reader back in the path of streamed content", () => {
    let api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);

    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));
    scrolledInto = [];

    api = agentApi(
      agentState({ items: [{ kind: "user", text: "go" }, { kind: "user", text: "and on" }] as ChatItem[] }),
    );
    view.rerender(<App />);

    expect(scrolledInto).toContain(bottomAnchor());
  });

  // openlore: scenario=SendsNothing spec=conversation-scroll-navigation
  it("changes nothing but the scroll position", () => {
    const { api } = mount();
    const box = screen.getByPlaceholderText(/message/i);
    fireEvent.change(box, { target: { value: "still writing this" } });
    const itemsBefore = document.querySelectorAll("[data-item-index]").length;

    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    expect(api.prompt).not.toHaveBeenCalled();
    expect(api.editPrompt).not.toHaveBeenCalled();
    expect(api.abort).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-item-index]")).toHaveLength(itemsBefore);
    expect(box).toHaveValue("still writing this");
  });

  // openlore: scenario=NoYankWhileReadingScrollback spec=conversation-scroll-navigation
  it("leaves a reader in the scrollback where they are while content streams", () => {
    let api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);

    scrollUp();
    scrolledInto = [];

    api = agentApi(
      agentState({ items: [{ kind: "user", text: "go" }, { kind: "user", text: "and on" }] as ChatItem[] }),
    );
    view.rerender(<App />);

    expect(scrolledInto).toHaveLength(0);
    expect(control()).toBeInTheDocument();
  });

  // openlore: scenario=FollowsWhenNearBottom spec=conversation-scroll-navigation
  it("follows streamed content for a reader who never left the bottom", () => {
    let api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);

    scrollDown();
    scrolledInto = [];

    api = agentApi(
      agentState({ items: [{ kind: "user", text: "go" }, { kind: "user", text: "and on" }] as ChatItem[] }),
    );
    view.rerender(<App />);

    expect(scrolledInto).toContain(bottomAnchor());
    expect(control()).toBeNull();
  });

  it("stays away through the frames of its own animation", () => {
    // A smooth scroll emits a scroll event per frame, and all but the last report
    // a viewport still far from the end. Read naively they flicker the control
    // back on for the length of the animation — observed in the browser before
    // this guard existed — and stop streamed content being followed meanwhile.
    mount();
    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    const main = scroller();
    for (const scrollTop of [400, 1200, 2400, 3400]) {
      layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop });
      fireEvent.scroll(main);
      expect(control()).toBeNull();
    }
  });

  it("hands control straight back to a reader who scrolls during the return", () => {
    mount();
    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));

    const main = scroller();
    fireEvent.wheel(main);
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 200 });
    fireEvent.scroll(main);

    // Their gesture, not our animation: the button comes back and the transcript
    // stops following, which is the whole point of the scrollback protection.
    expect(control()).toBeInTheDocument();
  });

  it("hands control back to a drag that emits no gesture of its own", () => {
    // A scrollbar drag fires scroll events and nothing else. The only thing that
    // separates it from the animation is the direction: nothing this app starts
    // moves away from the end.
    mount();
    const main = scroller();
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 2000 });
    fireEvent.scroll(main);
    expect(control()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: CONTROL }));
    expect(control()).toBeNull();

    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 1500 });
    fireEvent.scroll(main);

    expect(control()).toBeInTheDocument();
  });

  it("lets go of the guard when the scroll settles short of the end", () => {
    // A reader who drags the scrollbar towards the end and releases early emits
    // no gesture, and every position they pass through moves the same way the
    // animation was going. `scrollend` is the only thing that separates them.
    mount();
    const main = scroller();
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 2000 });
    fireEvent.scroll(main);
    fireEvent.click(screen.getByRole("button", { name: CONTROL }));
    expect(control()).toBeNull();

    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 2600 });
    fireEvent.scroll(main);
    expect(control()).toBeNull(); // indistinguishable from the animation, so far

    fireEvent(main, new Event("scrollend"));

    // Settled, and not at the end: the reader is reading scrollback again.
    expect(control()).toBeInTheDocument();
  });

  describe("the end moving without a scroll", () => {
    /** A ResizeObserver whose notifications this test fires by hand. */
    function stubResizeObserver() {
      const callbacks: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      return () => act(() => {
        for (const notify of callbacks) notify();
      });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("goes with content that finishes rendering under a reader it is following", () => {
      // A diagram or image that lays out after its message arrived grows the
      // transcript with no item to trigger the effect that follows it. Reading the
      // new distance back would file a reader who never touched the page as having
      // walked away from it — and strand them there, no control offered.
      const resize = stubResizeObserver();
      mount();
      scrollDown();
      scrolledInto = [];

      layout(scroller(), { scrollHeight: 4000, clientHeight: 600, scrollTop: 1000 });
      resize();

      expect(scrolledInto).toContain(bottomAnchor());
      expect(control()).toBeNull();
    });

    it("takes the control away when the end comes back within reach", () => {
      // The other direction, and the one no scroll event reports: a window that
      // grew, or a transcript that shrank, can put the end back inside the region
      // without the reader moving at all.
      const resize = stubResizeObserver();
      mount();
      scrollUp();
      expect(control()).toBeInTheDocument();

      layout(scroller(), { scrollHeight: 640, clientHeight: 600, scrollTop: 0 });
      resize();

      expect(control()).toBeNull();
    });
  });

  it("watches the scroller an embed mounts only once its branding has settled", () => {
    // The embed paints nothing until the branding request returns. An effect that
    // reached for the scroller on the first render found null, and nothing in its
    // dependencies changed when the real interface arrived — so the embedded
    // widget got no observer at all.
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );

    let api = agentApi(agentState({ brandingReady: false, items: [] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App rootElement={document.createElement("div")} />);
    expect(document.querySelector("main")).toBeNull(); // nothing painted yet

    api = agentApi(agentState({ brandingReady: true, items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    view.rerender(<App rootElement={document.createElement("div")} />);

    expect(callbacks.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("does not let a stream cancel a jump that has only just set off", () => {
    // The jump is a smooth scroll: for its first frames the reader is still
    // inside the near-bottom region. Waiting for one of them to prove they left
    // leaves a window in which a streamed item pulls them back to the end and
    // undoes the navigation they asked for.
    const items: ChatItem[] = [
      { kind: "user", text: "go" },
      { kind: "assistant", blocks: [{ type: "text", text: "first" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
      { kind: "user", text: "more" },
      { kind: "assistant", blocks: [{ type: "text", text: "second" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
    ];
    let api = agentApi(agentState({ items }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);
    scrollDown();

    // The target sits above the viewport: jsdom gives every box zeros, so the
    // one fact this turns on has to be stated.
    const main = scroller();
    main.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    const target = document.querySelector('[data-item-index="1"]')!;
    target.getBoundingClientRect = () => ({ top: -900, bottom: -700, left: 0, right: 800, width: 800, height: 200, x: 0, y: -900, toJSON: () => ({}) });

    fireEvent.click(screen.getByTitle(/turns? ·/));
    fireEvent.click(screen.getAllByRole("button", { name: /^Turn 1:/ })[0]);

    scrolledInto = [];
    api = agentApi(agentState({ items: [...items, { kind: "user", text: "and on" }] as ChatItem[] }));
    view.rerender(<App />);

    // The stream did not drag them back to the end.
    expect(scrolledInto).not.toContain(bottomAnchor());
  });

  it("keeps following a stream whose own catch-up scroll starts far from the end", () => {
    // A turn or tool card taller than the near-bottom region starts the automatic
    // scroll from outside it. Its intermediate frames report a viewport far from
    // the end, and read as a departure they would show the control and stop the
    // follow midway through the stream.
    let api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);
    scrollDown();

    const main = scroller();
    // The tall card has landed: the end is now far below the viewport.
    layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 1000 });
    api = agentApi(
      agentState({ items: [{ kind: "user", text: "go" }, { kind: "user", text: "a tall one" }] as ChatItem[] }),
    );
    view.rerender(<App />);

    for (const scrollTop of [1600, 2600, 3400]) {
      layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop });
      fireEvent.scroll(main);
      expect(control()).toBeNull();
    }

    // And still following: another item arrives and the transcript goes with it.
    scrolledInto = [];
    api = agentApi(
      agentState({
        items: [
          { kind: "user", text: "go" },
          { kind: "user", text: "a tall one" },
          { kind: "user", text: "and another" },
        ] as ChatItem[],
      }),
    );
    view.rerender(<App />);
    expect(scrolledInto).toContain(bottomAnchor());
  });

  it("goes away when the transcript is replaced by one with nothing to scroll", () => {
    // The scroller survives a session switch. A reader parked at the top of a
    // long conversation who switches to a short one keeps scrollTop 0 — now the
    // bottom — and the browser emits no scroll event to say so.
    let api = agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] }));
    mockUseAgent.mockImplementation(() => api);
    const view = render(<App />);

    scrollUp();
    expect(control()).toBeInTheDocument();

    layout(scroller(), { scrollHeight: 400, clientHeight: 400, scrollTop: 0 });
    api = agentApi(agentState({ sessionId: "sess_2", items: [] as ChatItem[] }));
    view.rerender(<App />);

    expect(control()).toBeNull();
  });

  it("keeps out from under the panels that overlay the conversation", () => {
    // Analysis and Work Plan are drawers at z-10, full width on a narrow
    // viewport. This control is rendered after them, so an equal level would
    // paint a transcript affordance on top of the panel covering the transcript.
    mockUseAgent.mockReturnValue(agentApi(agentState({ items: [{ kind: "user", text: "go" }] as ChatItem[] })));
    render(<App />);
    scrollUp();

    const strip = screen.getByRole("button", { name: CONTROL }).parentElement!;
    expect(strip.className).toContain("z-0");
    expect(strip.className).not.toContain("z-10");
  });

  describe("an analysis jump", () => {
    const items: ChatItem[] = [
      { kind: "user", text: "go" },
      { kind: "assistant", blocks: [{ type: "text", text: "first" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
      { kind: "user", text: "more" },
      { kind: "assistant", blocks: [{ type: "text", text: "second" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
    ];

    function jumpToFirstTurn() {
      fireEvent.click(screen.getByTitle(/turns? ·/));
      fireEvent.click(screen.getAllByRole("button", { name: /^Turn 1:/ })[0]);
    }

    beforeEach(() => {
      mockUseAgent.mockReturnValue(agentApi(agentState({ items })));
      render(<App />);
    });

    it("offers the way back once it has taken the reader out of the region", () => {
      scrollDown();
      jumpToFirstTurn();
      // What the browser does next, and jsdom does not: the jump's own scroll.
      scrollUp();

      expect(control()).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: CONTROL }));
      expect(control()).toBeNull();
    });

    it("leaves a reader at the bottom alone when it moves them nowhere", () => {
      // Jumping to something already on screen at the end scrolls nothing and
      // emits no scroll event. Treating that as a departure would strand the
      // reader: the transcript stops following, and the control that would fix
      // it is hidden precisely because they are at the bottom.
      scrollDown();
      jumpToFirstTurn();

      expect(control()).toBeNull();

      // Still followed: the point of not having called it a departure.
      scrolledInto = [];
      const main = scroller();
      layout(main, { scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 });
      fireEvent.scroll(main);
      expect(control()).toBeNull();
    });
  });
});

describe("Terminal integration in App", () => {
  it("toggles terminal panel and repoints workspace root", () => {
    const updateConfig = vi.fn();
    const openProject = vi.fn();
    mockUseAgent.mockReturnValue({
      ...agentApi(
        agentState({
          terminal: { enabled: true },
          workspace: { root: "/current/workspace" },
          sandbox: { root: "/current/workspace", allowWrite: true, allowBash: true },
        }),
      ),
      openProject,
      updateConfig,
    });

    render(<App />);

    const terminalButton = screen.getByRole("button", { name: />_ terminal/i });
    expect(terminalButton).toBeInTheDocument();

    // Open terminal
    fireEvent.click(terminalButton);
    expect(screen.getByText("terminal 1")).toBeInTheDocument();

    // Repoint via open as project button
    const syncButton = screen.getByTitle(/as the workspace project/i);
    fireEvent.click(syncButton);
    expect(openProject).toHaveBeenCalledWith("/current/workspace");
  });

  it("updates sandbox config when embedded or openProject unset", () => {
    const updateConfig = vi.fn();
    mockUseAgent.mockReturnValue({
      ...agentApi(
        agentState({
          terminal: { enabled: true },
          workspace: { root: "/current/workspace" },
          sandbox: { root: "/current/workspace", allowWrite: true, allowBash: true, writableRoot: "/current/workspace" },
        }),
      ),
      openProject: undefined,
      updateConfig,
    });

    render(<App token="test-token" />);

    const terminalButton = screen.getByRole("button", { name: />_ terminal/i });
    fireEvent.click(terminalButton);

    const syncButton = screen.getByTitle(/as the workspace project/i);
    fireEvent.click(syncButton);

    expect(updateConfig).toHaveBeenCalledWith({
      sandbox: {
        root: "/current/workspace",
        allowWrite: true,
        allowBash: true,
        writableRoot: "/current/workspace",
      },
    });
  });

  it("updates sandbox config on unconstrained server", () => {
    const updateConfig = vi.fn();
    mockUseAgent.mockReturnValue({
      ...agentApi(
        agentState({
          terminal: { enabled: true },
          workspace: { root: "/current/workspace" },
          sandbox: null,
        }),
      ),
      openProject: undefined,
      updateConfig,
    });

    render(<App token="test-token" />);

    const terminalButton = screen.getByRole("button", { name: />_ terminal/i });
    fireEvent.click(terminalButton);

    const syncButton = screen.getByTitle(/as the workspace project/i);
    fireEvent.click(syncButton);

    expect(updateConfig).toHaveBeenCalledWith({
      sandbox: {
        root: "/current/workspace",
        allowWrite: true,
        allowBash: true,
      },
    });
  });
});
