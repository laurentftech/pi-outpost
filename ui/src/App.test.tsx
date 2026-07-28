import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

beforeEach(() => {
  mockUseAgent.mockReset();
});

// ---------------------------------------------------------------------------
// TokenGate path — authRequired: true
// ---------------------------------------------------------------------------
describe("App — authRequired", () => {
  beforeEach(() => {
    mockUseAgent.mockReturnValue({
      state: {
        connected: false,
        authRequired: true,
        branding: { title: "Test App" },
        sessionId: "",
        model: "",
        thinkingLevel: "off",
        modelSupportsReasoning: false,
        models: [],
        commands: [],
        sessions: null,
        sessionSearch: null,
        tree: null,
        isStreaming: false,
        items: [],
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
      },
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
    });
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
    mockUseAgent.mockReturnValue({
      state: {
        connected: true,
        authRequired: false,
        branding: { title: "Pi" },
        sessionId: "sess_1",
        model: "",
        thinkingLevel: "off",
        modelSupportsReasoning: false,
        models: [],
        commands: [],
        sessions: null,
        sessionSearch: null,
        tree: null,
        isStreaming: false,
        items: [],
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
        credentials: { usableModel: false, hasProvider: true, hasKey: false, providers: [] },
        fileSearch: null,
        extensionPaths: [],
        sandbox: null,
        versions: null,
        gitAvailable: false,
        gitStatus: null,
        gitDiff: null,
        gitLog: null,
        gitShow: null,
      },
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
    });
  });

  it("renders the onboarding screen when no usable model", () => {
    render(<App />);
    // Should not render the main chat
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  });
});
