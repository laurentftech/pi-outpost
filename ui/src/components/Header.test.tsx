import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { SessionSummary } from "@pi-outpost/shared";
import { Header } from "./Header";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    path: "/sessions/a.jsonl",
    id: "a",
    firstMessage: "how do I start?",
    modified: "2026-08-01T10:00:00.000Z",
    messageCount: 4,
    ...overrides,
  };
}

const SESSIONS = [
  session(),
  session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser", firstMessage: "split it up", messageCount: 12 }),
];

type Props = React.ComponentProps<typeof Header>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = {
    onUpdateConfig: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleHideTools: vi.fn(),
    onToggleTheme: vi.fn(),
    onNewSession: vi.fn(),
    onSwitchSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onListSessions: vi.fn(),
    onRenameSession: vi.fn(),
    onSearchSessions: vi.fn(),
    onClearSessionSearch: vi.fn(),
    onListTree: vi.fn(),
    onNavigateTree: vi.fn(),
    onForkSession: vi.fn(),
    onFetchGitLog: vi.fn(),
    onShowCommit: vi.fn(),
  };
  const props: Props = {
    sessions: SESSIONS,
    sessionSearch: null,
    sessionId: "a",
    tree: null,
    isStreaming: false,
    connected: true,
    theme: "light",
    showThemeToggle: true,
    statuses: {},
    sidebarOpen: false,
    hideTools: false,
    gitAvailable: false,
    gitStatus: null,
    gitLog: null,
    extensionPaths: [],
    sandbox: null,
    ...handlers,
    ...overrides,
  };
  const view = render(<Header {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<Header {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const openSessions = () => fireEvent.click(screen.getByRole("button", { name: "sessions" }));
const searchBox = () => screen.getByRole("searchbox", { name: "Search sessions" });

describe("Header", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    confirmSpy.mockRestore();
  });

  describe("chrome", () => {
    it("shows the title when one is branded", () => {
      setup({ title: "π dev" });
      expect(screen.getByText("π dev")).toBeInTheDocument();
    });

    it("renders extension statuses verbatim", () => {
      setup({ statuses: { omni: "OmniRoute ✓", other: "2 jobs" } });
      expect(screen.getByText("OmniRoute ✓")).toBeInTheDocument();
      expect(screen.getByText("2 jobs")).toBeInTheDocument();
    });

    it("offers the theme toggle only when branding allows it", () => {
      const { rerenderWith, onToggleTheme } = setup({ theme: "light" });
      fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
      expect(onToggleTheme).toHaveBeenCalled();
      rerenderWith({ showThemeToggle: false });
      expect(screen.queryByRole("button", { name: /Switch to/ })).not.toBeInTheDocument();
    });

    it("names the toggle after where it takes you", () => {
      setup({ theme: "dark" });
      expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    });

    it("shows the branch chip only when git is available", () => {
      const { rerenderWith } = setup({ gitAvailable: false });
      expect(screen.queryByRole("button", { name: /⎇/ })).not.toBeInTheDocument();
      rerenderWith({ gitAvailable: true, gitStatus: { branch: "main", ahead: 0, behind: 0, files: {} } });
      expect(screen.getByRole("button", { name: /main/ })).toBeInTheDocument();
    });

    it("starts a new session", () => {
      const { onNewSession } = setup();
      fireEvent.click(screen.getByRole("button", { name: /new/ }));
      expect(onNewSession).toHaveBeenCalled();
    });
  });

  describe("the session menu", () => {
    it("asks for the list when it opens, from a clean slate", () => {
      const { onListSessions, onClearSessionSearch } = setup();
      openSessions();
      expect(onListSessions).toHaveBeenCalled();
      expect(onClearSessionSearch).toHaveBeenCalled();
    });

    it("lists sessions by name, falling back to the first message", () => {
      setup();
      openSessions();
      expect(screen.getByText("refactor the parser")).toBeInTheDocument();
      expect(screen.getByText("how do I start?")).toBeInTheDocument();
    });

    it("marks the current session", () => {
      setup({ sessionId: "b" });
      openSessions();
      expect(screen.getByText(/· current/)).toBeInTheDocument();
    });

    it("switches session and closes", () => {
      const { onSwitchSession } = setup();
      openSessions();
      fireEvent.click(screen.getByText("refactor the parser"));
      expect(onSwitchSession).toHaveBeenCalledWith("/sessions/b.jsonl");
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });

    it("says when there is nothing saved", () => {
      setup({ sessions: [] });
      openSessions();
      expect(screen.getByText("no saved sessions")).toBeInTheDocument();
    });

    it("says it is loading rather than claiming there is nothing", () => {
      setup({ sessions: null });
      openSessions();
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("closes when the pointer goes down outside", () => {
      setup();
      openSessions();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });

  describe("deleting", () => {
    it("asks before deleting", () => {
      const { onDeleteSession } = setup();
      openSessions();
      fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(onDeleteSession).toHaveBeenCalledWith("/sessions/b.jsonl");
    });

    it("does nothing when the prompt is declined", () => {
      confirmSpy.mockReturnValue(false);
      const { onDeleteSession } = setup();
      openSessions();
      fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
      expect(onDeleteSession).not.toHaveBeenCalled();
    });

    it("offers no delete for the session you are in", () => {
      setup({ sessionId: "a" });
      openSessions();
      // Only the other session can be deleted
      expect(screen.getAllByRole("button", { name: "Delete session" })).toHaveLength(1);
    });
  });

  describe("renaming", () => {
    it("commits a new name on Enter", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[0]);
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "onboarding notes" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onRenameSession).toHaveBeenCalledWith("/sessions/a.jsonl", "onboarding notes");
    });

    it("starts from the existing name", () => {
      setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[1]);
      expect(screen.getByRole("textbox", { name: "Session name" })).toHaveValue("refactor the parser");
    });

    it("clears the name when committed empty", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[1]);
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onRenameSession).toHaveBeenCalledWith("/sessions/b.jsonl", "");
    });

    it("abandons the rename on Escape", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[0]);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Session name" }), { key: "Escape" });
      expect(onRenameSession).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: "Session name" })).not.toBeInTheDocument();
    });
  });

  describe("searching sessions", () => {
    it("ignores a query too short to be worth a server scan", () => {
      const { onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "a" } });
      act(() => void vi.advanceTimersByTime(500));
      expect(onSearchSessions).not.toHaveBeenCalled();
    });

    it("searches after a pause, not on every keystroke", () => {
      const { onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      expect(onSearchSessions).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(500));
      expect(onSearchSessions).toHaveBeenCalledWith("par");
    });

    it("keeps waiting rather than calling a query a miss mid-flight", () => {
      setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.getByText("loading…")).toBeInTheDocument();
      expect(screen.queryByText("no matches")).not.toBeInTheDocument();
    });

    it("ignores results belonging to an older query", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "old", requestId: "s0", results: [] } });
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("shows matches with the excerpt that explains them", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      const hit = session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser", snippet: "…split the parser…" });
      rerenderWith({ sessionSearch: { status: "loaded", query: "par", requestId: "s1", results: [hit] } });
      expect(screen.getByText("…split the parser…")).toBeInTheDocument();
    });

    it("says a search found nothing, distinctly from an empty library", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "zzz" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "zzz", requestId: "s1", results: [] } });
      expect(screen.getByText("no matches")).toBeInTheDocument();
    });

    it("re-runs the search after a rename, since results are a server snapshot", () => {
      const { rerenderWith, onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      const hit = session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser" });
      rerenderWith({ sessionSearch: { status: "loaded", query: "par", requestId: "s1", results: [hit] } });
      act(() => void vi.advanceTimersByTime(500));
      onSearchSessions.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Rename session" }));
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "parser work" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onSearchSessions).toHaveBeenCalledWith("par");
    });

    it("drops the search when the box is emptied", () => {
      const { onClearSessionSearch } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      onClearSessionSearch.mockClear();
      fireEvent.change(searchBox(), { target: { value: "" } });
      expect(onClearSessionSearch).toHaveBeenCalled();
    });
  });

  describe("tool noise", () => {
    it("toggles the tool filter and says which state it is in", () => {
      const { onToggleHideTools, rerenderWith } = setup({ hideTools: false });
      const toggle = screen.getByRole("button", { name: /tools/ });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(toggle);
      expect(onToggleHideTools).toHaveBeenCalled();
      rerenderWith({ hideTools: true });
      expect(screen.getByRole("button", { name: /tools/ })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("toggles the sidebar", () => {
    const { onToggleSidebar } = setup();
    fireEvent.click(screen.getByRole("button", { name: /files/ }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("reports the connection state", () => {
    const { rerenderWith } = setup({ connected: true });
    expect(screen.getByTitle("connected")).toBeInTheDocument();
    rerenderWith({ connected: false });
    expect(screen.getByTitle(/disconnected|connecting/i)).toBeInTheDocument();
  });

  it("keeps the tree menu out of the way until asked", () => {
    const { onListTree } = setup();
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "tree" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(onListTree).toHaveBeenCalled();
  });
});
