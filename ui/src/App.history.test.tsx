/**
 * Reading a compacted conversation back, in the interface.
 *
 * What is asserted here is what the reader can see and do: whether the way back is
 * offered, where the compaction boundary sits, that a recovered prompt cannot be
 * edited, and that inserting older messages above the transcript leaves the reader
 * looking at the same message. The transport is covered by the server suites.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import App from "./App";

const mockUseAgent = vi.fn();
vi.mock("./useAgent", () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
}));

vi.mock("./components/PdfViewer", () => ({
  default: () => null,
}));

vi.mock("./theme/useTheme", () => ({
  useTheme: () => ({ theme: "dark" as const, toggle: vi.fn(), setTheme: vi.fn() }),
}));

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
    sessionName: null,
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
    olderHistory: null,
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

function agentApi(state: ReturnType<typeof agentState>, overrides: Record<string, unknown> = {}) {
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
    loadOlderItems: vi.fn(),
    fetchOlderItems: vi.fn(),
    respondToDialog: vi.fn(),
    dismissNotification: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    uploadFile: vi.fn(),
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
    openSideSession: vi.fn(),
    setOutcomeActive: vi.fn(),
    refreshOutcome: vi.fn(),
    closeServerBrowser: vi.fn(),
    openTerminal: vi.fn(),
    sendTerminalInput: vi.fn(),
    getTerminalCwd: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    subscribeTerminal: vi.fn(() => () => {}),
    ...overrides,
  };
}

const compacted: ChatItem[] = [
  { kind: "compaction", summary: "the first hour, in three lines", tokensBefore: 120_000 },
  { kind: "user", text: "kept prompt", entryId: "e9" },
  { kind: "assistant", blocks: [{ type: "text", text: "kept reply" }] },
];

beforeEach(() => {
  mockUseAgent.mockReset();
});

describe("the way back to the beginning", () => {
  it("offers to load what compaction removed, saying how much there is", () => {
    mockUseAgent.mockReturnValue(
      agentApi(agentState({ items: compacted, olderHistory: { remaining: 42, have: 0, loading: false, error: null } })),
    );
    render(<App />);
    expect(screen.getByRole("button", { name: "Load 42 earlier messages" })).toBeInTheDocument();
  });

  it("offers nothing when the transcript already starts at the first message", () => {
    mockUseAgent.mockReturnValue(agentApi(agentState({ items: compacted, olderHistory: null })));
    render(<App />);
    expect(screen.queryByRole("button", { name: /earlier message/ })).toBeNull();
  });

  it("offers nothing once the last chunk has been loaded", () => {
    mockUseAgent.mockReturnValue(
      agentApi(agentState({ items: compacted, olderHistory: { remaining: 0, have: 42, loading: false, error: null } })),
    );
    render(<App />);
    expect(screen.queryByRole("button", { name: /earlier message/ })).toBeNull();
  });

  it("asks the agent for the next chunk when activated, including from the keyboard", () => {
    const loadOlderItems = vi.fn();
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({ items: compacted, olderHistory: { remaining: 8, have: 0, loading: false, error: null } }),
        { loadOlderItems },
      ),
    );
    render(<App />);
    const control = screen.getByRole("button", { name: "Load 8 earlier messages" });
    fireEvent.click(control);
    expect(loadOlderItems).toHaveBeenCalledTimes(1);
    // A button answers Enter and Space natively; what matters is that it is a button
    // and reachable, not that the test re-implements the browser.
    expect(control.tagName).toBe("BUTTON");
    expect(control).not.toBeDisabled();
  });

  it("cannot be activated twice for the same chunk", () => {
    const loadOlderItems = vi.fn();
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({ items: compacted, olderHistory: { remaining: 8, have: 0, loading: true, error: null } }),
        { loadOlderItems },
      ),
    );
    render(<App />);
    const control = screen.getByRole("button", { name: "Loading earlier messages" });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(loadOlderItems).not.toHaveBeenCalled();
  });

  it("reports a failure and keeps the transcript, so the reader can retry", () => {
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({
          items: compacted,
          olderHistory: { remaining: 8, have: 0, loading: false, error: "the older messages did not arrive" },
        }),
      ),
    );
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("the older messages did not arrive");
    expect(screen.getByText("kept prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /earlier message/ })).not.toBeDisabled();
  });
});

describe("the compaction boundary", () => {
  it("is shown for a compacted session with nothing loaded, and says what the agent kept", () => {
    mockUseAgent.mockReturnValue(
      agentApi(agentState({ items: compacted, olderHistory: { remaining: 42, have: 0, loading: false, error: null } })),
    );
    render(<App />);
    const boundary = screen.getByRole("button", { name: /Conversation compacted here/ });
    expect(boundary).toHaveTextContent("120k tokens summarised");
    fireEvent.click(boundary);
    expect(screen.getByText("the first hour, in three lines")).toBeInTheDocument();
  });

  it("is absent from a conversation that was never compacted", () => {
    mockUseAgent.mockReturnValue(
      agentApi(agentState({ items: [{ kind: "user", text: "hello", entryId: "e1" }] as ChatItem[] })),
    );
    render(<App />);
    expect(screen.queryByText(/Conversation compacted here/)).toBeNull();
  });

  it("sits between the recovered messages and what the model still holds", () => {
    const items: ChatItem[] = [
      { kind: "user", text: "the very first prompt", readOnly: true },
      { kind: "compaction", summary: "summary", tokensBefore: 1_000 },
      { kind: "user", text: "kept prompt", entryId: "e9" },
    ];
    mockUseAgent.mockReturnValue(
      agentApi(agentState({ items, olderHistory: { remaining: 0, have: 1, loading: false, error: null } })),
    );
    render(<App />);
    const rendered = [...document.querySelectorAll("[data-item-index]")];
    const boundaryIndex = rendered.findIndex((node) => node.querySelector("[data-compaction-boundary]"));
    const recoveredIndex = rendered.findIndex((node) => node.textContent?.includes("the very first prompt"));
    const keptIndex = rendered.findIndex((node) => node.textContent?.includes("kept prompt"));
    expect(recoveredIndex).toBeLessThan(boundaryIndex);
    expect(boundaryIndex).toBeLessThan(keptIndex);
  });
});

describe("recovered messages are read-only", () => {
  it("offers no edit on a prompt from before the compaction point", () => {
    const items: ChatItem[] = [
      { kind: "user", text: "recovered prompt", readOnly: true },
      { kind: "user", text: "kept prompt", entryId: "e9" },
    ];
    mockUseAgent.mockReturnValue(agentApi(agentState({ items })));
    render(<App />);
    const bubbles = [...document.querySelectorAll("[data-item-index]")];
    const recovered = bubbles.find((node) => node.textContent?.includes("recovered prompt"))!;
    const kept = bubbles.find((node) => node.textContent?.includes("kept prompt"))!;
    expect(recovered.querySelector("button")).toBeNull();
    expect(kept.querySelector("button")).not.toBeNull();
  });

  it("still applies the conversation filters to recovered items", () => {
    const items: ChatItem[] = [
      {
        kind: "tool",
        toolCallId: "t1",
        toolName: "read",
        args: {},
        output: "recovered tool output",
        readOnly: true,
      },
      { kind: "assistant", blocks: [{ type: "thinking", text: "recovered reasoning" }], readOnly: true },
    ];
    mockUseAgent.mockReturnValue(agentApi(agentState({ items })));
    render(<App />);
    expect(screen.getByText(/read/)).toBeInTheDocument();

    // Hiding tools must hide a recovered card exactly as it hides a live one.
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Tool calls/ }));
    expect(screen.queryByText(/recovered tool output/)).toBeNull();
  });
});

describe("loading older messages does not move the reader", () => {
  it("keeps the scroll position by the height the insert added", async () => {
    const loadOlderItems = vi.fn();
    const state = agentState({
      items: compacted,
      olderHistory: { remaining: 8, have: 0, loading: false, error: null },
    });
    const api = agentApi(state, { loadOlderItems });
    mockUseAgent.mockReturnValue(api);
    const view = render(<App />);

    // jsdom lays nothing out: stand in for the scroller's geometry, then grow it the
    // way a prepend does. What is asserted is the correction, which is the part that
    // has to be right — a prepend that adds 400px must move scrollTop by 400px.
    const scroller = document.querySelector("main")!;
    let height = 1_000;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 500 });
    scroller.scrollTop = 120;

    fireEvent.click(screen.getByRole("button", { name: "Load 8 earlier messages" }));
    expect(loadOlderItems).toHaveBeenCalled();

    height = 1_400;
    const olderItems: ChatItem[] = [{ kind: "user", text: "the very first prompt", readOnly: true }];
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({
          items: [...olderItems, ...compacted],
          olderHistory: { remaining: 7, have: 1, loading: false, error: null },
        }),
        { loadOlderItems },
      ),
    );
    await act(async () => {
      view.rerender(<App />);
    });

    expect(scroller.scrollTop).toBe(520);
    expect(screen.getByText("the very first prompt")).toBeInTheDocument();
  });
});

describe("taking the conversation away", () => {
  it("offers the export only once there is a conversation", () => {
    mockUseAgent.mockReturnValue(agentApi(agentState({ items: [] })));
    const empty = render(<App />);
    expect(screen.queryByRole("button", { name: "Export the conversation as HTML" })).toBeNull();
    empty.unmount();

    mockUseAgent.mockReturnValue(agentApi(agentState({ items: compacted })));
    render(<App />);
    expect(screen.getByRole("button", { name: "Export the conversation as HTML" })).toBeInTheDocument();
  });

  it("reports a refused export and leaves the conversation alone", async () => {
    // A compacted conversation whose prefix cannot be fetched: the export must refuse
    // rather than hand over the visible tail under the conversation's name.
    const fetchOlderItems = vi.fn(async () => {
      throw new Error("the older messages did not arrive");
    });
    mockUseAgent.mockReturnValue(
      agentApi(
        agentState({
          items: compacted,
          olderHistory: { remaining: 12, have: 0, loading: false, error: null },
        }),
        { fetchOlderItems },
      ),
    );
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export the conversation as HTML" }));
    });
    await screen.findByText(/could not be read back/);
    expect(screen.getByText("kept prompt")).toBeInTheDocument();
  });
});
