import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import App from "./App";

// Mock useAgent to return a controlled state without WebSocket dependency
const mockUseAgent = vi.fn();
vi.mock("./useAgent", () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
}));

// Mock useTheme to avoid matchMedia / message listeners
vi.mock("./theme/useTheme", () => ({
  useTheme: () => ({ theme: "dark" as const, toggle: vi.fn(), setTheme: vi.fn() }),
}));

/** The agent state App reads, with only the fields a test cares about overridden. */
function agentState(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
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
    openFile: null,
    credentials: null,
    fileSearch: null,
    extensionPaths: [],
    sandbox: null,
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
  };
}

beforeEach(() => {
  mockUseAgent.mockReset();
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

  it("shows the file viewer over the conversation when a file is open", () => {
    mount({ openFile: { status: "loaded", path: "src/main.ts", content: "const a = 1;", size: 12, mtimeMs: 1 } });
    expect(screen.getByRole("button", { name: "Close file viewer" })).toBeInTheDocument();
  });

  it("asks for a file's history from the viewer", () => {
    const { api } = mount({
      gitAvailable: true,
      openFile: { status: "loaded", path: "src/main.ts", content: "x", size: 1, mtimeMs: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: /history/ }));
    expect(api.fetchGitFileHistory).toHaveBeenCalledWith("src/main.ts");
  });

  it("shows the history pane once the answer arrives", () => {
    mount({
      gitAvailable: true,
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
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: { "readme.md": "modified" } },
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
