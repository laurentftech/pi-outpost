import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
