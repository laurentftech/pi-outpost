import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgent } from "./useAgent";

// ---------------------------------------------------------------------------
// Mock WebSocket — gives us full control over connection lifecycle
// ---------------------------------------------------------------------------
let mockWs: MockWebSocket | null = null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    mockWs = this;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code: 1000 }));
    }
  }

  /** Test helper: simulate the server opening the connection. */
  open() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  /** Test helper: simulate a server message. */
  receive(msg: Record<string, unknown>) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(msg) }));
    }
  }

  /** Test helper: simulate close with a given code. */
  disconnect(code: number) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close", { code }));
    }
  }
}

// Make the hook use our mock
beforeEach(() => {
  mockWs = null;
  vi.stubGlobal("WebSocket", MockWebSocket);

  // Provide a stable crypto.randomUUID
  let id = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `mock-id-${++id}` });

  // Branding fetch: respond with OK + empty branding
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});


// ---------------------------------------------------------------------------
// Shared harness: a connected hook with a session already established.
// ---------------------------------------------------------------------------
/** Renders the hook, opens the socket, and replays a `hello` with `items`. */
async function connected(items: unknown[] = [], hello: Record<string, unknown> = {}) {
  const { result } = renderHook(() => useAgent());
  act(() => mockWs!.open());
  await waitFor(() => expect(result.current.state.connected).toBe(true));
  act(() =>
    mockWs!.receive({
      type: "hello",
      sessionId: "sess_1",
      branding: {},
      model: "",
      thinkingLevel: "off",
      models: [],
      commands: [],
      isStreaming: false,
      items,
      contextUsage: null,
      gitAvailable: false,
      ...hello,
    }),
  );
  await waitFor(() => expect(result.current.state.sessionId).toBe("sess_1"));
  return result;
}

/** The requestId of the last frame the hook sent. */
function lastRequestId() {
  return JSON.parse(mockWs!.sent[mockWs!.sent.length - 1]).requestId as string;
}

const userItem = (text: string) => ({ kind: "user", text });

const outcome = (workspaceRoot = "/a", sessionId = "sess_1") => ({
  workspaceRoot,
  sessionId,
  sections: [
    { id: "work-plan", title: "Work Plan", order: 10, availability: "available", entries: [] },
    { id: "future", title: "Future", order: 20, availability: "unavailable", summary: "offline", entries: [] },
  ],
});

describe("workspace Outcome", () => {
  it("correlates a result and retains available sections beside an unavailable contributor", async () => {
    const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
    act(() => result.current.setOutcomeActive(true));
    const requestId = lastRequestId();
    expect(JSON.parse(mockWs!.sent.at(-1)!).type).toBe("get_outcome");
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId, outcome: outcome() }));
    await waitFor(() => expect(result.current.state.outcome?.status).toBe("loaded"));
    const state = result.current.state.outcome;
    expect(state?.status === "loaded" && state.outcome.sections.map((section) => section.availability)).toEqual(["available", "unavailable"]);
  });

  it("discards stale request, session, and workspace responses", async () => {
    const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
    act(() => result.current.setOutcomeActive(true));
    const requestId = lastRequestId();
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId: "older", outcome: outcome() }));
    expect(result.current.state.outcome?.status).toBe("loading");
    act(() => mockWs!.receive({
      type: "workspace_switched",
      sessionId: "sess_2",
      workspace: { root: "/b", name: "b", activity: "idle" },
      workspaces: [], branding: {}, model: "", thinkingLevel: "off", models: [], commands: [], isStreaming: false, items: [],
    }));
    expect(result.current.state.outcome).toBeNull();
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId, outcome: outcome("/a", "sess_1") }));
    expect(result.current.state.outcome).toBeNull();
  });

  it("drops a loaded Outcome when the workspace or the session it describes is replaced", async () => {
    // Correlation only discards late answers. A result already on screen has to
    // go too: it is a claim about one workspace and one session, and the drawer
    // would otherwise render it under whichever comes next until a refresh lands.
    for (const replacement of [
      {
        type: "workspace_switched",
        sessionId: "sess_2",
        workspace: { root: "/b", name: "b", activity: "idle" },
        workspaces: [], branding: {}, model: "", thinkingLevel: "off", models: [], commands: [], isStreaming: false, items: [],
      },
      {
        type: "session_replaced",
        sessionId: "sess_3",
        workspace: { root: "/a", name: "a", activity: "idle" },
        workspaces: [], branding: {}, model: "", thinkingLevel: "off", models: [], commands: [], isStreaming: false, items: [],
      },
    ]) {
      const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
      act(() => result.current.setOutcomeActive(true));
      act(() => mockWs!.receive({ type: "workspace_outcome", requestId: lastRequestId(), outcome: outcome() }));
      await waitFor(() => expect(result.current.state.outcome?.status).toBe("loaded"));

      act(() => mockWs!.receive(replacement));
      expect(result.current.state.outcome).toBeNull();
    }
  });

  it("asks again for an open Outcome once the connection comes back", async () => {
    // The socket that owed the answer is gone and the close handler dropped what
    // was in flight. With nobody asking again the panel renders its loading state
    // for as long as the drawer stays open.
    const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
    act(() => result.current.setOutcomeActive(true));
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId: lastRequestId(), outcome: outcome() }));
    await waitFor(() => expect(result.current.state.outcome?.status).toBe("loaded"));

    act(() => mockWs!.disconnect(1006));
    // The hook retries on a timer; wait for the socket it opens next.
    const dropped = mockWs;
    await waitFor(() => expect(mockWs).not.toBe(dropped), { timeout: 4_000 });
    const before = mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome").length;
    act(() => mockWs!.open());
    await waitFor(() => expect(mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome")).toHaveLength(before + 1));
  });

  it("coalesces a burst into one trailing refresh while Outcome is open", async () => {
    const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
    act(() => result.current.setOutcomeActive(true));
    const firstId = lastRequestId();
    const before = mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome").length;
    act(() => {
      mockWs!.receive({ type: "directory_changed", path: "src" });
      mockWs!.receive({ type: "work_plan_changed", workPlan: null });
      mockWs!.receive({ type: "agent_end" });
    });
    expect(mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome")).toHaveLength(before);
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId: firstId, outcome: outcome() }));
    await waitFor(() => expect(mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome")).toHaveLength(before + 1));
  });

  it("settles queued refreshes across rapid drawer toggles and remains manually refreshable", async () => {
    const result = await connected([], { workspace: { root: "/a", name: "a", activity: "idle" } });
    act(() => result.current.setOutcomeActive(true));
    const firstId = lastRequestId();
    act(() => {
      result.current.setOutcomeActive(false);
      result.current.setOutcomeActive(true);
      result.current.setOutcomeActive(false);
      result.current.setOutcomeActive(true);
    });
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId: firstId, outcome: outcome() }));
    await waitFor(() => expect(mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome")).toHaveLength(2));
    const trailingId = lastRequestId();
    act(() => mockWs!.receive({ type: "workspace_outcome", requestId: trailingId, outcome: outcome() }));
    act(() => result.current.refreshOutcome());
    await waitFor(() => expect(mockWs!.sent.filter((frame) => JSON.parse(frame).type === "get_outcome")).toHaveLength(3));
  });
});

// ---------------------------------------------------------------------------
// Connect lifecycle
// ---------------------------------------------------------------------------
describe("connect lifecycle", () => {
  it("creates a WebSocket to the default URL", () => {
    renderHook(() => useAgent());

    expect(mockWs).not.toBeNull();
    expect(mockWs!.url).toMatch(/\/ws$/);
  });

  it("transitions to connected when the socket opens", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());

    await waitFor(() => expect(result.current.state.connected).toBe(true));
  });

  it("transitions to disconnected when the socket closes", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    act(() => mockWs!.disconnect(1000));
    await waitFor(() => expect(result.current.state.connected).toBe(false));
  });

  /**
   * An embedding host names the project its widget shows; the widget never offers
   * to change it. The name has to reach the server on the upgrade, because that
   * is the only moment the binding is decided — and a widget that silently showed
   * the server's default project instead would look like it worked.
   */
  it("names the workspace on the upgrade when the host supplies one", () => {
    renderHook(() => useAgent("", undefined, true, "/srv/beta"));

    expect(new URL(mockWs!.url).searchParams.get("workspace")).toBe("/srv/beta");
  });

  it("names no workspace when the host supplies none", () => {
    renderHook(() => useAgent("", undefined, true));

    expect(new URL(mockWs!.url).searchParams.has("workspace")).toBe(false);
  });

  it("carries the token and the workspace together", () => {
    renderHook(() => useAgent("http://example.test", "s3cret", true, "/srv/beta"));

    const params = new URL(mockWs!.url).searchParams;
    expect(params.get("token")).toBe("s3cret");
    expect(params.get("workspace")).toBe("/srv/beta");
  });

  it("shows authRequired when closed with code 4401", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    act(() => mockWs!.disconnect(4401));
    await waitFor(() => expect(result.current.state.authRequired).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Hello message (session snapshot)
// ---------------------------------------------------------------------------
describe("switching projects", () => {
  /** The snapshot a switch answers with, as the server sends it. */
  function switched(root: string) {
    return {
      type: "workspace_switched",
      sessionId: `session-${root}`,
      branding: {},
      model: "",
      thinkingLevel: "off",
      models: [],
      commands: [],
      isStreaming: false,
      items: [],
      contextUsage: null,
      gitAvailable: false,
      workspace: { root, name: root.split("/").pop(), activity: "idle", needsAttention: false },
      workspaces: [
        { root: "/srv/alpha", name: "alpha", activity: "idle", needsAttention: false },
        { root: "/srv/beta", name: "beta", activity: "idle", needsAttention: false },
      ],
    };
  }

  it("forgets the screen the project was left on", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());

    // A file open, a diff up, a tree expanded — none of it belongs to the project
    // being switched to, and carrying it across would show one project's file
    // under another's conversation.
    act(() => result.current.readFile("notes.md"));
    const requestId = (JSON.parse(mockWs!.sent[mockWs!.sent.length - 1]) as { requestId: string }).requestId;
    act(() => mockWs!.receive({ type: "file_content", requestId, path: "notes.md", content: "hi", size: 2, mtimeMs: 1 }));
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));

    act(() => mockWs!.receive(switched("/srv/beta")));

    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));
    expect(result.current.state.openFile).toBeNull();
    expect(result.current.state.gitDiff).toBeNull();
    expect(result.current.state.fileTree).toEqual({});
  });

  it("keeps the project list current as activity arrives from elsewhere", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    act(() => mockWs!.receive(switched("/srv/beta")));
    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));

    act(() =>
      mockWs!.receive({
        type: "workspace_activity",
        workspaces: [
          { root: "/srv/alpha", name: "alpha", activity: "working", needsAttention: false },
          { root: "/srv/beta", name: "beta", activity: "waiting", needsAttention: true },
        ],
      }),
    );

    await waitFor(() => expect(result.current.state.workspaces[0].activity).toBe("working"));
    // The bound project's own entry follows the list, or the header would show a
    // state the menu contradicts.
    expect(result.current.state.workspace?.needsAttention).toBe(true);
  });

  /** The frames this client sent, newest last, as objects. */
  function sentFrames() {
    return mockWs!.sent.map((raw) => JSON.parse(raw) as { type: string; root?: string });
  }

  it("asks for another project, and fades the conversation while it waits", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    act(() => mockWs!.receive(switched("/srv/beta")));
    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));

    act(() => result.current.switchWorkspace("/srv/alpha"));

    expect(sentFrames().at(-1)).toEqual({ type: "switch_workspace", root: "/srv/alpha" });
    // Fading rather than emptying: a blank pane makes a switch read as a reload.
    expect(result.current.state.switching).toBe(true);
  });

  it("says nothing when the project asked for is the one already bound", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    act(() => mockWs!.receive(switched("/srv/beta")));
    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));
    const before = mockWs!.sent.length;

    act(() => result.current.switchWorkspace("/srv/beta"));

    // A round trip that answers with the snapshot already on screen would still
    // fade the conversation and throw the open file away.
    expect(mockWs!.sent.length).toBe(before);
    expect(result.current.state.switching).toBe(false);
  });

  it("opens a directory as a project, and waits the same way a switch does", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    act(() => mockWs!.receive(switched("/srv/beta")));
    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));

    act(() => result.current.openProject("/srv/gamma"));

    expect(sentFrames().at(-1)).toEqual({ type: "open_project", root: "/srv/gamma" });
    expect(result.current.state.switching).toBe(true);
  });

  it("closes a project without disturbing the one on screen", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    act(() => mockWs!.receive(switched("/srv/beta")));
    await waitFor(() => expect(result.current.state.workspace?.root).toBe("/srv/beta"));

    act(() => result.current.closeProject("/srv/alpha"));

    expect(sentFrames().at(-1)).toEqual({ type: "close_project", root: "/srv/alpha" });
    // Closing another project changes nothing here — and the server refuses it
    // outright while that project is streaming.
    expect(result.current.state.switching).toBe(false);
    expect(result.current.state.workspace?.root).toBe("/srv/beta");
  });
});

describe("hello message handling", () => {
  it("populates state from a hello message", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    act(() =>
      mockWs!.receive({
        type: "hello",
        sessionId: "sess_abc",
        branding: { title: "Test" },
        model: "claude-sonnet-4",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [
          { kind: "user", text: "hello", images: [] },
          { kind: "assistant", blocks: [], streaming: false },
        ],
        contextUsage: null,
        gitAvailable: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.state.sessionId).toBe("sess_abc");
    });
    expect(result.current.state.branding.title).toBe("Test");
    expect(result.current.state.items).toHaveLength(2);
  });

  it("keeps WebSocket branding when the earlier HTTP request settles without branding", async () => {
    let settleBranding!: (response: { ok: boolean }) => void;
    vi.stubGlobal("fetch", () => new Promise<{ ok: boolean }>((resolve) => (settleBranding = resolve)));
    const { result } = renderHook(() => useAgent());

    act(() =>
      mockWs!.receive({
        type: "hello",
        sessionId: "sess_abc",
        branding: { title: "From WebSocket" },
        model: "",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    await waitFor(() => expect(result.current.state.branding.title).toBe("From WebSocket"));

    await act(async () => settleBranding({ ok: false }));

    expect(result.current.state.brandingReady).toBe(true);
    expect(result.current.state.branding.title).toBe("From WebSocket");
  });
});

describe("the prompt bubble, before the server has echoed it", () => {
  it("appears as soon as it is sent", async () => {
    // The server broadcasts `user` only once the runtime accepts the prompt —
    // after session creation, runtime start-up, and the wait for a loaded
    // provider to take the request. Until this, those seconds showed nothing:
    // the composer emptied and the transcript did not move.
    const result = await connected();
    act(() => result.current.prompt("what does this repo do?"));
    expect(result.current.state.pendingPrompt).toEqual({ text: "what does this repo do?" });
    // It is not in `items`: `user_entries` pairs bubbles to persisted entry ids
    // counting from the end, and an unsent one would take its neighbour's id.
    expect(result.current.state.items).toEqual([]);
    expect(JSON.parse(mockWs!.sent[mockWs!.sent.length - 1])).toEqual({
      type: "prompt",
      text: "what does this repo do?",
    });
  });

  it("gives way to the real bubble, without doubling it", async () => {
    const result = await connected();
    act(() => result.current.prompt("hello"));
    act(() => mockWs!.receive({ type: "user", text: "hello" }));
    expect(result.current.state.pendingPrompt).toBeNull();
    expect(result.current.state.items).toEqual([{ kind: "user", text: "hello" }]);
  });

  it("carries its attachments while it waits", async () => {
    const result = await connected();
    const images = [{ dataUrl: "data:image/png;base64,AAA", name: "shot.png" }];
    act(() => result.current.prompt("look", images as never));
    expect(result.current.state.pendingPrompt).toEqual({ text: "look", images });
  });

  it("disappears when the server refuses the prompt", async () => {
    // A refusal is an `error` and never a `user`. Left behind, the placeholder
    // would stand there as a message that was never sent.
    const result = await connected();
    act(() => result.current.prompt("during a session switch"));
    act(() => mockWs!.receive({ type: "error", message: "Session change already in progress" }));
    expect(result.current.state.pendingPrompt).toBeNull();
    expect(result.current.state.items).toEqual([]);
  });

  it("does not survive a snapshot that says what the conversation contains", async () => {
    const result = await connected();
    act(() => result.current.prompt("sent just before the switch"));
    act(() =>
      mockWs!.receive({
        type: "session_replaced",
        sessionId: "sess_2",
        branding: {},
        model: "",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    expect(result.current.state.pendingPrompt).toBeNull();
  });
});

describe("Work Plan synchronization", () => {
  it("applies live changes and replaces the plan with the selected session snapshot", async () => {
    const result = await connected();
    const first = { version: 1, id: "first", title: "First", updatedAt: "2026-08-23T00:00:00.000Z", tasks: [] };
    act(() => mockWs!.receive({ type: "work_plan_changed", workPlan: first }));
    await waitFor(() => expect(result.current.state.workPlan?.id).toBe("first"));

    act(() => mockWs!.receive({
      type: "session_replaced",
      sessionId: "sess_2",
      branding: {},
      model: "",
      thinkingLevel: "off",
      models: [],
      commands: [],
      isStreaming: false,
      items: [],
      workPlan: null,
      gitAvailable: false,
    }));
    await waitFor(() => expect(result.current.state.sessionId).toBe("sess_2"));
    expect(result.current.state.workPlan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
describe("streaming", () => {
  it("tracks agent_start / agent_end", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    // Send a hello to establish the session
    act(() =>
      mockWs!.receive({
        type: "hello",
        sessionId: "sess_1",
        branding: {},
        model: "",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    await waitFor(() => expect(result.current.state.sessionId).toBe("sess_1"));

    // Agent starts
    act(() => mockWs!.receive({ type: "agent_start" }));
    await waitFor(() => expect(result.current.state.isStreaming).toBe(true));

    // Block delta
    act(() =>
      mockWs!.receive({
        type: "block_delta",
        contentIndex: 0,
        block: "text",
        delta: "Hello ",
      }),
    );
    act(() =>
      mockWs!.receive({
        type: "block_delta",
        contentIndex: 0,
        block: "text",
        delta: "world!",
      }),
    );

    await waitFor(() => {
      const items = result.current.state.items;
      expect(items).toHaveLength(1);
      const last = items[0];
      if (last.kind === "assistant") {
        expect(last.blocks[0].text).toBe("Hello world!");
      }
    });

    // Agent ends
    act(() =>
      mockWs!.receive({
        type: "assistant_end",
        item: { kind: "assistant", blocks: [{ type: "text", text: "Hello world!" }], streaming: false },
      }),
    );
    act(() => mockWs!.receive({ type: "agent_end" }));
    await waitFor(() => expect(result.current.state.isStreaming).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------
describe("API methods", () => {
  it("submitToken stores the token and triggers reconnection", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    // Track old socket to verify it gets replaced
    const oldWs = mockWs;

    act(() => {
      result.current.submitToken("new-token");
    });

    // Should create a new WebSocket
    await waitFor(() => {
      expect(mockWs).not.toBe(oldWs);
    });
  });

  it("prompt sends a message", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    act(() => {
      result.current.prompt("Hello agent");
    });

    expect(mockWs!.sent).toHaveLength(1);
    const msg = JSON.parse(mockWs!.sent[0]);
    expect(msg.type).toBe("prompt");
    expect(msg.text).toBe("Hello agent");
  });

  it("abort sends an abort message", async () => {
    const { result } = renderHook(() => useAgent());

    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));

    act(() => {
      result.current.abort();
    });

    expect(mockWs!.sent).toHaveLength(1);
    expect(JSON.parse(mockWs!.sent[0]).type).toBe("abort");
  });
});

// ---------------------------------------------------------------------------
// user_entries — pairing bubbles to session entries
//
// The riskiest reducer in the hook: an entryId is what an edit rewinds to, so a
// mispaired bubble silently rewinds the wrong turn.
// ---------------------------------------------------------------------------
describe("user_entries pairing", () => {
  it("pairs bubbles to entries from the end", async () => {
    const result = await connected([userItem("first"), userItem("second")]);

    act(() =>
      mockWs!.receive({
        type: "user_entries",
        entries: [
          { entryId: "e1", text: "first" },
          { entryId: "e2", text: "second" },
        ],
      }),
    );

    await waitFor(() => {
      const items = result.current.state.items;
      expect(items[0].kind === "user" && items[0].entryId).toBe("e1");
      expect(items[1].kind === "user" && items[1].entryId).toBe("e2");
    });
  });

  it("pairs only the suffix when compaction dropped older entries", async () => {
    // The server keeps the whole branch; the transcript starts mid-way.
    const result = await connected([userItem("second"), userItem("third")]);

    act(() =>
      mockWs!.receive({
        type: "user_entries",
        entries: [
          { entryId: "e1", text: "first" },
          { entryId: "e2", text: "second" },
          { entryId: "e3", text: "third" },
        ],
      }),
    );

    await waitFor(() => {
      const items = result.current.state.items;
      expect(items[0].kind === "user" && items[0].entryId).toBe("e2");
      expect(items[1].kind === "user" && items[1].entryId).toBe("e3");
    });
  });

  it("stops at the first mismatch instead of shifting every id", async () => {
    // "local only" was never persisted (an extension command, an aborted steer).
    // Pairing past it would hand each older bubble its neighbour's entry.
    const result = await connected([userItem("first"), userItem("local only"), userItem("third")]);

    act(() =>
      mockWs!.receive({
        type: "user_entries",
        entries: [
          { entryId: "e1", text: "first" },
          { entryId: "e3", text: "third" },
        ],
      }),
    );

    await waitFor(() => {
      const items = result.current.state.items;
      expect(items[2].kind === "user" && items[2].entryId).toBe("e3");
      // Everything before the mismatch loses its id rather than getting a wrong one.
      expect(items[1].kind === "user" && items[1].entryId).toBeUndefined();
      expect(items[0].kind === "user" && items[0].entryId).toBeUndefined();
    });
  });

  it("drops an id that no longer pairs", async () => {
    const result = await connected([userItem("first")]);

    act(() => mockWs!.receive({ type: "user_entries", entries: [{ entryId: "e1", text: "first" }] }));
    await waitFor(() => expect(result.current.state.items[0].kind === "user" && result.current.state.items[0].entryId).toBe("e1"));

    act(() => mockWs!.receive({ type: "user_entries", entries: [{ entryId: "e9", text: "something else" }] }));
    await waitFor(() => {
      const item = result.current.state.items[0];
      expect(item.kind === "user" && "entryId" in item).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Stale answers — every one of these guards a silent wrong-data bug
// ---------------------------------------------------------------------------
describe("stale responses", () => {
  it("ignores file content for a read the user has moved on from", async () => {
    const result = await connected();

    act(() => result.current.readFile("a.ts"));
    const first = lastRequestId();
    act(() => result.current.readFile("b.ts"));

    act(() =>
      mockWs!.receive({ type: "file_content", requestId: first, path: "a.ts", content: "old", size: 3, mtimeMs: 1 }),
    );

    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loading"));
    expect(result.current.state.openFile?.path).toBe("b.ts");
  });

  it("ignores file search results from a superseded query", async () => {
    const result = await connected();

    act(() => result.current.searchFiles("a"));
    const first = lastRequestId();
    act(() => result.current.searchFiles("ab"));

    act(() => mockWs!.receive({ type: "file_search_results", requestId: first, results: ["stale.ts"] }));

    await waitFor(() => expect(result.current.state.fileSearch?.status).toBe("loading"));
    expect(result.current.state.fileSearch?.results).toEqual([]);
  });

  it("ignores session search results from a superseded query", async () => {
    const result = await connected();

    act(() => result.current.searchSessions("a"));
    const first = lastRequestId();
    act(() => result.current.searchSessions("ab"));

    act(() => mockWs!.receive({ type: "session_search_results", requestId: first, sessions: [{ id: "s1" }] }));

    await waitFor(() => expect(result.current.state.sessionSearch?.status).toBe("loading"));
    expect(result.current.state.sessionSearch?.results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File and directory creation
// ---------------------------------------------------------------------------
describe("file creation", () => {
  function lastSent() {
    return JSON.parse(mockWs!.sent[mockWs!.sent.length - 1]) as Record<string, unknown>;
  }

  it("asks for a file with its own message, never a write", async () => {
    const result = await connected();

    act(() => result.current.createFile("src/new.ts"));

    const sent = lastSent();
    expect(sent.type).toBe("create_file");
    expect(sent.path).toBe("src/new.ts");
    expect(String(sent.requestId)).toMatch(/^create:/);
  });

  it("asks for a directory with its own message", async () => {
    const result = await connected();

    act(() => result.current.createDirectory("src/newdir"));

    const sent = lastSent();
    expect(sent.type).toBe("create_directory");
    expect(sent.path).toBe("src/newdir");
  });

  it("opens the created file, empty and ready to edit", async () => {
    const result = await connected();
    act(() => result.current.createFile("src/new.ts"));

    act(() => mockWs!.receive({ type: "file_written", requestId: lastRequestId(), path: "src/new.ts", size: 0, mtimeMs: 42 }));

    await waitFor(() => {
      const file = result.current.state.openFile;
      expect(file?.status).toBe("loaded");
      expect(file?.status === "loaded" && file.content).toBe("");
      expect(file?.status === "loaded" && file.mtimeMs).toBe(42);
      expect(file?.status === "loaded" && file.justCreated).toBe(true);
    });
  });

  it("keeps a refusal on the tree instead of opening anything", async () => {
    const result = await connected();
    act(() => result.current.createFile("src/taken.ts"));

    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "src/taken.ts",
        message: '"src/taken.ts" already exists',
        reason: "conflict",
      }),
    );

    await waitFor(() => expect(result.current.state.createError?.path).toBe("src/taken.ts"));
    expect(result.current.state.createError?.message).toMatch(/already exists/);
    expect(result.current.state.openFile).toBeNull();
  });

  it("clears the previous refusal when a new attempt starts", async () => {
    const result = await connected();
    act(() => result.current.createFile("src/taken.ts"));
    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "src/taken.ts",
        message: "already exists",
        reason: "conflict",
      }),
    );
    await waitFor(() => expect(result.current.state.createError).not.toBeNull());

    act(() => result.current.createFile("src/other.ts"));

    expect(result.current.state.createError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File lifecycle operations
// ---------------------------------------------------------------------------
describe("file lifecycle operations", () => {
  function lastSent() {
    return JSON.parse(mockWs!.sent[mockWs!.sent.length - 1]) as Record<string, unknown>;
  }

  async function withLoadedFile(path = "draft.docx") {
    const result = await connected();
    act(() => result.current.readFile(path));
    act(() =>
      mockWs!.receive({
        type: "file_content",
        requestId: lastRequestId(),
        path,
        content: "draft",
        size: 5,
        mtimeMs: 10,
      }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));
    return result;
  }

  it("sends typed lifecycle requests with correlated ids", async () => {
    const result = await connected();

    act(() => result.current.openNative("report.docx"));
    expect(lastSent()).toMatchObject({ type: "open_native", path: "report.docx" });
    expect(String(lastSent().requestId)).toMatch(/^fileop:/);

    act(() => result.current.renameFile("report.docx", "final.docx"));
    expect(lastSent()).toMatchObject({ type: "rename_file", path: "report.docx", name: "final.docx" });

    act(() => result.current.deleteFile("report.docx"));
    expect(lastSent()).toMatchObject({ type: "delete_file", path: "report.docx" });

    act(() => result.current.moveFile("report.docx", "archive"));
    expect(lastSent()).toMatchObject({ type: "move_file", path: "report.docx", destinationDirectory: "archive" });

    act(() => result.current.copyFile("readonly.docx", "archive"));
    expect(lastSent()).toMatchObject({ type: "copy_file", path: "readonly.docx", destinationDirectory: "archive" });
  });

  it("moves an open viewer to the acknowledged rename path", async () => {
    const result = await withLoadedFile();
    act(() => result.current.renameFile("draft.docx", "final.docx"));

    act(() =>
      mockWs!.receive({
        type: "file_operation_result",
        requestId: lastRequestId(),
        operation: "rename_file",
        previousPath: "draft.docx",
        path: "final.docx",
      }),
    );

    await waitFor(() => expect(result.current.state.openFile?.path).toBe("final.docx"));
    expect(result.current.state.fileOperation).toMatchObject({ status: "succeeded", resultPath: "final.docx" });
  });

  it("keeps a read-only source open after its copy is acknowledged", async () => {
    const result = await withLoadedFile("readonly.docx");
    act(() => result.current.copyFile("readonly.docx", "archive"));

    act(() =>
      mockWs!.receive({
        type: "file_operation_result",
        requestId: lastRequestId(),
        operation: "copy_file",
        path: "archive/readonly.docx",
      }),
    );

    await waitFor(() => expect(result.current.state.fileOperation?.status).toBe("succeeded"));
    expect(result.current.state.openFile?.path).toBe("readonly.docx");
  });

  it("does not reread a stale source path when rename notifications follow the acknowledgement", async () => {
    const result = await withLoadedFile();
    act(() => result.current.renameFile("draft.docx", "final.docx"));
    const requestId = lastRequestId();
    const sentBeforeResult = mockWs!.sent.length;

    act(() => {
      mockWs!.receive({
        type: "file_operation_result",
        requestId,
        operation: "rename_file",
        previousPath: "draft.docx",
        path: "final.docx",
      });
      mockWs!.receive({ type: "file_changed", path: "draft.docx" });
      mockWs!.receive({ type: "file_changed", path: "final.docx" });
    });

    const followUps = mockWs!.sent.slice(sentBeforeResult).map((raw) => JSON.parse(raw) as Record<string, unknown>);
    expect(followUps).not.toContainEqual(expect.objectContaining({ type: "read_file", path: "draft.docx" }));
    expect(followUps).toContainEqual(expect.objectContaining({ type: "read_file", path: "final.docx" }));
  });

  it("keeps the open file's content on screen while a self-triggered re-read is in flight", async () => {
    // Regression: file_read_started used to blank openFile to "loading" for this
    // re-read too, unmounting the rendered markdown for a moment on every save —
    // the same class of bug the file tree already guards against for directory
    // refreshes (see the "directory_changed" suite), just never carried over here.
    const result = await withLoadedFile();

    act(() => mockWs!.receive({ type: "file_changed", path: "draft.docx" }));
    expect(result.current.state.openFile).toMatchObject({ status: "loaded", path: "draft.docx", content: "draft" });

    act(() =>
      mockWs!.receive({
        type: "file_content",
        requestId: lastRequestId(),
        path: "draft.docx",
        content: "draft, edited elsewhere",
        size: 20,
        mtimeMs: 20,
      }),
    );
    expect(result.current.state.openFile).toMatchObject({ status: "loaded", content: "draft, edited elsewhere" });
  });

  it("moves an open viewer to the acknowledged destination path", async () => {
    const result = await withLoadedFile("inbox/report.docx");
    act(() => result.current.moveFile("inbox/report.docx", "archive"));

    act(() =>
      mockWs!.receive({
        type: "file_operation_result",
        requestId: lastRequestId(),
        operation: "move_file",
        previousPath: "inbox/report.docx",
        path: "archive/report.docx",
      }),
    );

    await waitFor(() => expect(result.current.state.openFile?.path).toBe("archive/report.docx"));
  });

  it("closes the viewer after the displayed file is deleted", async () => {
    const result = await withLoadedFile("delete-me.txt");
    act(() => result.current.deleteFile("delete-me.txt"));

    act(() =>
      mockWs!.receive({
        type: "file_operation_result",
        requestId: lastRequestId(),
        operation: "delete_file",
        path: "delete-me.txt",
      }),
    );

    await waitFor(() => expect(result.current.state.openFile).toBeNull());
  });

  it("keeps the viewer and exposes a correlated operation error", async () => {
    const result = await withLoadedFile();
    act(() => result.current.renameFile("draft.docx", "taken.docx"));

    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "draft.docx",
        message: '"taken.docx" already exists',
        reason: "conflict",
      }),
    );

    await waitFor(() => expect(result.current.state.fileOperation?.status).toBe("error"));
    expect(result.current.state.openFile?.path).toBe("draft.docx");
    expect(result.current.state.fileOperation).toMatchObject({ operation: "rename_file", path: "draft.docx" });
  });
});

// ---------------------------------------------------------------------------
// File writes and errors — routed by requestId prefix
// ---------------------------------------------------------------------------
describe("file writes", () => {
  async function withLoadedFile() {
    const result = await connected();
    act(() => result.current.readFile("a.ts"));
    act(() =>
      mockWs!.receive({
        type: "file_content",
        requestId: lastRequestId(),
        path: "a.ts",
        content: "before",
        size: 6,
        mtimeMs: 10,
      }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));
    return result;
  }

  it("commits the saved buffer when the write is acknowledged", async () => {
    const result = await withLoadedFile();

    act(() => result.current.writeFile("a.ts", "after", 10));
    act(() => mockWs!.receive({ type: "file_written", requestId: lastRequestId(), size: 5, mtimeMs: 20 }));

    await waitFor(() => {
      const file = result.current.state.openFile;
      expect(file?.status === "loaded" && file.content).toBe("after");
      expect(file?.status === "loaded" && file.mtimeMs).toBe(20);
    });
  });

  it("reports a conflicting write as a retryable save error", async () => {
    const result = await withLoadedFile();

    act(() => result.current.writeFile("a.ts", "after", 10));
    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "a.ts",
        message: "changed on disk",
        reason: "conflict",
      }),
    );

    await waitFor(() => {
      const file = result.current.state.openFile;
      expect(file?.status === "loaded" && file.saveError?.conflict).toBe(true);
      expect(file?.status === "loaded" && file.pendingSave).toBeUndefined();
      // The buffer on disk is not adopted: the editor keeps what the user typed.
      expect(file?.status === "loaded" && file.content).toBe("before");
    });
  });

  it("surfaces a lost connection instead of leaving the editor saving", async () => {
    const result = await withLoadedFile();

    act(() => result.current.writeFile("a.ts", "after", 10));
    act(() => mockWs!.disconnect(1006));

    await waitFor(() => {
      const file = result.current.state.openFile;
      expect(file?.status === "loaded" && file.pendingSave).toBeUndefined();
      expect(file?.status === "loaded" && file.saveError?.message).toMatch(/Connection lost/);
    });
  });

  it("routes a directory error to that directory, not the error banner", async () => {
    const result = await connected();

    act(() => result.current.listDirectory("src"));
    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "src",
        message: "permission denied",
      }),
    );

    await waitFor(() => expect(result.current.state.fileTree["src"]).toEqual({ error: "permission denied" }));
    expect(result.current.state.errors).toEqual([]);
  });

  it("reports a failed read on the file preview itself", async () => {
    const result = await connected();

    act(() => result.current.readFile("missing.ts"));
    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "missing.ts",
        message: "no such file",
      }),
    );

    await waitFor(() => expect(result.current.state.openFile?.status).toBe("error"));
  });
});

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
describe("git messages", () => {
  it("keys the working-tree status by path", async () => {
    const result = await connected();

    act(() =>
      mockWs!.receive({
        type: "git_status",
        repos: [{ repo: "", branch: "main", ahead: 1, behind: 0 }],
        files: [{ path: "a.ts", status: "modified" }],
      }),
    );

    await waitFor(() => expect(result.current.state.gitStatus?.files["a.ts"]).toBe("modified"));
    expect(result.current.state.gitStatus?.repos[0]?.branch).toBe("main");
  });

  it("carries every repository's branch, and files from all of them", async () => {
    const result = await connected();

    act(() =>
      mockWs!.receive({
        type: "git_status",
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 2, behind: 0 },
        ],
        files: [
          { path: "projA/a.ts", status: "modified" },
          { path: "projB/b.ts", status: "untracked" },
        ],
      }),
    );

    await waitFor(() => expect(result.current.state.gitStatus?.files["projA/a.ts"]).toBe("modified"));
    expect(result.current.state.gitStatus?.files["projB/b.ts"]).toBe("untracked");
    expect(result.current.state.gitStatus?.repos.map((repo) => repo.branch)).toEqual(["main", "release"]);
  });

  it("lets a scoped answer replace one repository's slice and leave the rest standing", async () => {
    const result = await connected();
    act(() =>
      mockWs!.receive({
        type: "git_status",
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 0, behind: 0 },
        ],
        files: [
          { path: "projA/a.ts", status: "modified" },
          { path: "projB/b.ts", status: "modified" },
        ],
      }),
    );
    await waitFor(() => expect(result.current.state.gitStatus?.files["projA/a.ts"]).toBe("modified"));

    // projA is now clean and one commit ahead; projB was not asked about at all
    act(() =>
      mockWs!.receive({
        type: "git_status",
        repo: "projA",
        repos: [{ repo: "projA", branch: "main", ahead: 1, behind: 0 }],
        files: [],
      }),
    );

    await waitFor(() => expect(result.current.state.gitStatus?.files["projA/a.ts"]).toBeUndefined());
    expect(result.current.state.gitStatus?.files["projB/b.ts"]).toBe("modified");
    expect(result.current.state.gitStatus?.repos).toEqual([
      { repo: "projA", branch: "main", ahead: 1, behind: 0 },
      { repo: "projB", branch: "release", ahead: 0, behind: 0 },
    ]);
  });

  it("starts asking about git when a workspace that had no repository gains one", async () => {
    // The gate that makes this message necessary: told at connect there was no
    // repository, the client suppresses every git request from then on
    const result = await connected([], { gitAvailable: false });
    const before = mockWs.sent.length;
    act(() => mockWs!.receive({ type: "file_changed", path: "projA/README.md" }));
    expect(mockWs.sent.slice(before).filter((raw) => JSON.parse(raw).type === "git_status")).toHaveLength(0);

    act(() => mockWs!.receive({ type: "git_repositories_changed", available: true }));

    await waitFor(() => expect(result.current.state.gitAvailable).toBe(true));
    await waitFor(() =>
      expect(mockWs.sent.slice(before).filter((raw) => JSON.parse(raw).type === "git_status").length).toBeGreaterThan(0),
    );
  });

  it("stops describing repositories the workspace no longer has", async () => {
    const result = await connected([], { gitAvailable: true });
    act(() =>
      mockWs!.receive({
        type: "git_status",
        repos: [{ repo: "only", branch: "main", ahead: 0, behind: 0 }],
        files: [{ path: "only/a.ts", status: "modified" }],
      }),
    );
    await waitFor(() => expect(result.current.state.gitStatus?.files["only/a.ts"]).toBe("modified"));

    act(() => mockWs!.receive({ type: "git_repositories_changed", available: false }));

    await waitFor(() => expect(result.current.state.gitAvailable).toBe(false));
    // The badges and the branch chip would otherwise go on describing what is gone
    expect(result.current.state.gitStatus).toBeNull();
  });

  it("keeps one repository's commits from rendering as another's", async () => {
    const result = await connected([], { gitAvailable: true });
    act(() =>
      mockWs!.receive({
        type: "git_log",
        requestId: "gitlog:1",
        repo: "projA",
        entries: [{ sha: "aaaaaaa", author: "Ada", date: new Date().toISOString(), subject: "in projA" }],
      }),
    );
    await waitFor(() => expect(result.current.state.gitLog?.repo).toBe("projA"));
    expect(result.current.state.gitLog?.entries).toHaveLength(1);
  });

  it("sweeps every repository when a turn ends, since bash can touch any of them", async () => {
    await connected([], { gitAvailable: true });
    // Connecting already asked once; settle it, or the next request coalesces into it
    act(() => mockWs!.receive({ type: "git_status", repos: [], files: [] }));
    const before = mockWs.sent.length;

    act(() => mockWs!.receive({ type: "agent_end" }));

    await waitFor(() => {
      const statuses = mockWs.sent
        .slice(before)
        .map((raw) => JSON.parse(raw) as { type: string; repo?: string })
        .filter((frame) => frame.type === "git_status");
      expect(statuses).toHaveLength(1);
      expect(statuses[0].repo).toBeUndefined();
    });
  });

  it("asks only the changed file's repository for a fresh status", async () => {
    const result = await connected([], { gitAvailable: true });
    act(() =>
      mockWs!.receive({
        type: "git_status",
        repos: [
          { repo: "projA", branch: "main", ahead: 0, behind: 0 },
          { repo: "projB", branch: "release", ahead: 0, behind: 0 },
        ],
        files: [],
      }),
    );
    await waitFor(() => expect(result.current.state.gitStatus?.repos).toHaveLength(2));

    act(() => mockWs!.receive({ type: "file_changed", path: "projB/b.ts" }));

    await waitFor(() => {
      const statuses = mockWs!.sent
        .map((raw) => JSON.parse(raw) as { type: string; repo?: string })
        .filter((frame) => frame.type === "git_status");
      expect(statuses.at(-1)?.repo).toBe("projB");
    });
  });

  it("shows a diff failure in the diff pane, where the viewer covers the banner", async () => {
    const result = await connected();
    act(() => result.current.readFile("a.ts"));
    act(() =>
      mockWs!.receive({ type: "file_content", requestId: lastRequestId(), path: "a.ts", content: "x", size: 1, mtimeMs: 1 }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));

    act(() => result.current.fetchGitDiff("a.ts"));
    act(() => mockWs!.receive({ type: "git_error", requestId: lastRequestId(), message: "not a git repo" }));

    await waitFor(() => expect(result.current.state.gitDiff).toEqual({ path: "a.ts", error: "not a git repo" }));
    expect(result.current.state.errors).toEqual([]);
  });

  it("shows any other git failure in the error banner", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "git_error", requestId: "gitlog:1", message: "bad revision" }));

    await waitFor(() => expect(result.current.state.errors).toEqual(["git: bad revision"]));
  });
});

// ---------------------------------------------------------------------------
// Streaming and tool lifecycle
// ---------------------------------------------------------------------------
describe("streaming lifecycle", () => {
  it("keeps two content blocks apart while they interleave", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "agent_start" }));
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 0, block: "thinking", delta: "hmm" }));
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 1, block: "text", delta: "answer" }));
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 0, block: "thinking", delta: "…still" }));

    await waitFor(() => {
      const item = result.current.state.items[0];
      if (item.kind !== "assistant") throw new Error("expected an assistant item");
      expect(item.blocks).toHaveLength(2);
      expect(item.blocks[0]).toMatchObject({ type: "thinking", text: "hmm…still" });
      expect(item.blocks[1]).toMatchObject({ type: "text", text: "answer" });
    });
  });

  it("replaces the streaming bubble with the finished turn, usage and all", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "agent_start" }));
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 0, block: "text", delta: "part" }));
    act(() =>
      mockWs!.receive({
        type: "assistant_end",
        item: {
          kind: "assistant",
          blocks: [{ type: "text", text: "partial then whole" }],
          usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: 0.001 },
        },
      }),
    );

    await waitFor(() => {
      // One bubble, not two: the finished item replaces the in-flight one.
      expect(result.current.state.items).toHaveLength(1);
      const item = result.current.state.items[0];
      expect(item.kind === "assistant" && item.usage?.totalTokens).toBe(14);
    });
  });

  it("updates a tool card in place and clears its running flag", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "agent_start" }));
    act(() =>
      mockWs!.receive({ type: "tool_start", toolCallId: "call-1", toolName: "read", args: { path: "a.ts" } }),
    );
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 0, block: "text", delta: "meanwhile" }));
    act(() => mockWs!.receive({ type: "tool_end", toolCallId: "call-1", text: "contents", isError: false }));

    await waitFor(() => {
      const tools = result.current.state.items.filter((item) => item.kind === "tool");
      expect(tools).toHaveLength(1); // updated in place, not appended twice
      expect(tools[0].kind === "tool" && tools[0].output).toBe("contents");
      expect(tools[0].kind === "tool" && tools[0].running).toBe(false);
    });
  });

  it("stops claiming work is in flight when the agent ends", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "agent_start" }));
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "call-1", toolName: "read", args: {} }));
    act(() => mockWs!.receive({ type: "block_delta", contentIndex: 0, block: "text", delta: "hi" }));
    act(() => mockWs!.receive({ type: "agent_end" }));

    await waitFor(() => expect(result.current.state.isStreaming).toBe(false));
    // A card left spinning after the run ended is the visible symptom of this bug.
    for (const item of result.current.state.items) {
      if (item.kind === "tool") expect(item.running).toBe(false);
      if (item.kind === "assistant") expect(item.streaming).toBeFalsy();
    }
  });
});

// ---------------------------------------------------------------------------
// Extension UI bridge
// ---------------------------------------------------------------------------
describe("extension UI", () => {
  const request = (fields: Record<string, unknown>) => ({ type: "extension_ui_request", id: "r1", ...fields });

  it("sets and clears a status entry", async () => {
    const result = await connected();

    act(() => mockWs!.receive(request({ method: "setStatus", statusKey: "lint", statusText: "running" })));
    await waitFor(() => expect(result.current.state.statuses.lint).toBe("running"));

    act(() => mockWs!.receive(request({ method: "setStatus", statusKey: "lint" })));
    await waitFor(() => expect("lint" in result.current.state.statuses).toBe(false));
  });

  it("defaults a widget to the editor's top placement and removes it when cleared", async () => {
    const result = await connected();

    act(() => mockWs!.receive(request({ method: "setWidget", widgetKey: "todo", widgetLines: ["one"] })));
    await waitFor(() => expect(result.current.state.widgets.todo).toEqual({ lines: ["one"], placement: "aboveEditor" }));

    act(() => mockWs!.receive(request({ method: "setWidget", widgetKey: "todo" })));
    await waitFor(() => expect("todo" in result.current.state.widgets).toBe(false));
  });

  it("queues dialogs and drops the answered one", async () => {
    const result = await connected();

    act(() => mockWs!.receive(request({ id: "d1", method: "confirm", message: "sure?" })));
    act(() => mockWs!.receive(request({ id: "d2", method: "input", message: "name?" })));
    await waitFor(() => expect(result.current.state.dialogQueue).toHaveLength(2));

    act(() => result.current.respondToDialog({ id: "d1", result: true }));
    await waitFor(() => expect(result.current.state.dialogQueue).toHaveLength(1));
    expect(result.current.state.dialogQueue[0].id).toBe("d2");
  });

  it("dismisses one notification without touching the others", async () => {
    const result = await connected();

    act(() => mockWs!.receive(request({ id: "n1", method: "notify", message: "first", notifyType: "info" })));
    act(() => mockWs!.receive(request({ id: "n2", method: "notify", message: "second", notifyType: "warn" })));
    await waitFor(() => expect(result.current.state.notifications).toHaveLength(2));

    act(() => result.current.dismissNotification("n1"));
    await waitFor(() => expect(result.current.state.notifications).toHaveLength(1));
    expect(result.current.state.notifications[0].id).toBe("n2");
  });
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
describe("credentials_changed", () => {
  it("adopts the new model list without eating the error that came with it", async () => {
    const result = await connected();

    act(() => mockWs!.receive({ type: "error", message: "allowedModels leaves no usable model" }));
    act(() =>
      mockWs!.receive({
        type: "credentials_changed",
        model: "anthropic/claude-opus-5",
        models: [{ provider: "anthropic", id: "claude-opus-5", reasoning: true }],
        credentials: { usableModel: true, hasProvider: true, hasKey: true, providers: [] },
      }),
    );

    await waitFor(() => expect(result.current.state.model).toBe("anthropic/claude-opus-5"));
    expect(result.current.state.modelSupportsReasoning).toBe(true);
    expect(result.current.state.errors).toHaveLength(1);
  });

  it("drops a stale accepted-levels list when credentials change the model", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));
    act(() =>
      mockWs!.receive({
        type: "hello",
        sessionId: "s",
        branding: {},
        model: "local/a",
        thinkingLevel: "off",
        thinkingLevels: ["off", "low", "medium"],
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    await waitFor(() => expect(result.current.state.thinkingLevels).toEqual(["off", "low", "medium"]));
    act(() =>
      mockWs!.receive({
        type: "credentials_changed",
        model: "local/b",
        models: [{ provider: "local", id: "b", reasoning: true }],
        credentials: { usableModel: true, hasProvider: true, hasKey: true, providers: [] },
      }),
    );
    expect(result.current.state.thinkingLevels).toBeUndefined();
  });
});

describe("thinking levels", () => {
  it("stores the accepted-levels list from the snapshot", async () => {
    const { result } = renderHook(() => useAgent());
    act(() => mockWs!.open());
    await waitFor(() => expect(result.current.state.connected).toBe(true));
    act(() =>
      mockWs!.receive({
        type: "hello",
        sessionId: "s",
        branding: {},
        model: "local/qwen",
        thinkingLevel: "medium",
        thinkingLevels: ["off", "low", "medium", "xhigh"],
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    await waitFor(() => expect(result.current.state.thinkingLevels).toEqual(["off", "low", "medium", "xhigh"]));
  });

  it("replaces the list on model_changed, and clears it when the message omits one", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "model_changed", model: "local/a", reasoning: true, thinkingLevels: ["off", "high"] }));
    await waitFor(() => expect(result.current.state.thinkingLevels).toEqual(["off", "high"]));

    act(() => mockWs!.receive({ type: "model_changed", model: "local/b", reasoning: true }));
    expect(result.current.state.thinkingLevels).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The transcript as the server builds it. These are the messages that arrive on
// every turn, and the reducer's job is to fold each into the right item rather
// than append a new one — a streaming reply is one bubble, not a hundred.
// ---------------------------------------------------------------------------
describe("assembling a turn", () => {
  it("appends the prompt the server echoes back", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "user", text: "hello", images: [{ data: "AA", mimeType: "image/png" }] }));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    expect(result.current.state.items[0]).toMatchObject({ kind: "user", text: "hello" });
  });

  it("grows one assistant bubble as the deltas arrive", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "assistant_start" }));
    act(() => mockWs!.receive({ type: "block_delta", block: "text", delta: "Hel", contentIndex: 0 }));
    act(() => mockWs!.receive({ type: "block_delta", block: "text", delta: "lo", contentIndex: 0 }));

    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    const item = result.current.state.items[0] as { blocks: { text: string }[]; streaming?: boolean };
    expect(item.blocks[0].text).toBe("Hello");
    expect(item.streaming).toBe(true);
  });

  it("keeps thinking and text as separate blocks of the same reply", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "assistant_start" }));
    act(() => mockWs!.receive({ type: "block_delta", block: "thinking", delta: "hmm", contentIndex: 0 }));
    act(() => mockWs!.receive({ type: "block_delta", block: "text", delta: "answer", contentIndex: 1 }));

    const item = result.current.state.items[0] as { blocks: { type: string }[] };
    await waitFor(() => expect(item.blocks).toHaveLength(2));
    expect(result.current.state.items).toHaveLength(1);
  });

  it("replaces the streamed bubble with the server's final version", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "assistant_start" }));
    act(() => mockWs!.receive({ type: "block_delta", block: "text", delta: "partial", contentIndex: 0 }));
    act(() =>
      mockWs!.receive({
        type: "assistant_end",
        item: { kind: "assistant", blocks: [{ type: "text", text: "the whole answer" }] },
      }),
    );

    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    expect(result.current.state.items[0]).toMatchObject({ blocks: [{ text: "the whole answer" }] });
  });

  it("stops marking the reply as streaming when the turn ends", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "agent_start" }));
    act(() => mockWs!.receive({ type: "assistant_start" }));
    act(() => mockWs!.receive({ type: "agent_end" }));

    await waitFor(() => expect(result.current.state.isStreaming).toBe(false));
    expect(result.current.state.items[0]).toMatchObject({ streaming: false });
  });

  it("folds a tool's start, output and end into one card", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } }));
    act(() => mockWs!.receive({ type: "tool_update", toolCallId: "t1", text: "a.txt" }));
    act(() => mockWs!.receive({ type: "tool_end", toolCallId: "t1", text: "a.txt\nb.txt", isError: false }));

    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    expect(result.current.state.items[0]).toMatchObject({ kind: "tool", toolName: "bash", output: "a.txt\nb.txt", running: false });
  });

  it("carries a tool's completion fraction, and keeps the last one when an update omits it", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "t1", toolName: "crawl", args: {} }));
    act(() => mockWs!.receive({ type: "tool_update", toolCallId: "t1", text: "step 1", progress: 0.25 }));
    await waitFor(() => expect(result.current.state.items[0]).toMatchObject({ progress: 0.25, running: true }));

    // a text-only update must not clear the fraction
    act(() => mockWs!.receive({ type: "tool_update", toolCallId: "t1", text: "step 2" }));
    expect(result.current.state.items[0]).toMatchObject({ output: "step 2", progress: 0.25 });

    // ending the tool stops it running — the bar's gate closes regardless of the value left behind
    act(() => mockWs!.receive({ type: "tool_end", toolCallId: "t1", text: "done", isError: false }));
    expect(result.current.state.items[0]).toMatchObject({ running: false });
  });

  it("does not set progress from a text-only tool_update", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "t1", toolName: "crawl", args: {} }));
    act(() => mockWs!.receive({ type: "tool_update", toolCallId: "t1", text: "working" }));
    expect(result.current.state.items[0].progress).toBeUndefined();
  });

  it("keeps two concurrent tool calls apart", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "t1", toolName: "read", args: {} }));
    act(() => mockWs!.receive({ type: "tool_start", toolCallId: "t2", toolName: "grep", args: {} }));
    act(() => mockWs!.receive({ type: "tool_end", toolCallId: "t1", text: "first", isError: false }));

    await waitFor(() => expect(result.current.state.items).toHaveLength(2));
    expect(result.current.state.items[0]).toMatchObject({ output: "first", running: false });
    expect(result.current.state.items[1]).toMatchObject({ running: true });
  });

  it("appends an extension's own message kind", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "custom_message", item: { kind: "custom", customType: "plan", text: "step 1" } }));
    await waitFor(() => expect(result.current.state.items[0]).toMatchObject({ kind: "custom", customType: "plan" }));
  });

  it("tracks the thinking level the server confirms", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "thinking_changed", level: "high" }));
    await waitFor(() => expect(result.current.state.thinkingLevel).toBe("high"));
  });

  it("tracks the queue and the context usage", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "queue", steering: ["stop"], followUp: ["then this"] }));
    act(() => mockWs!.receive({ type: "context_usage", usage: { tokens: 100, contextWindow: 1000, percent: 10 } }));

    await waitFor(() => expect(result.current.state.queue.steering).toEqual(["stop"]));
    expect(result.current.state.contextUsage).toMatchObject({ percent: 10 });
  });
});

describe("compaction", () => {
  it("reports it while it runs", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "compaction_start" }));
    await waitFor(() => expect(result.current.state.isCompacting).toBe(true));
    act(() => mockWs!.receive({ type: "compaction_end" }));
    await waitFor(() => expect(result.current.state.isCompacting).toBe(false));
  });

  it("surfaces a compaction that failed", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "compaction_start" }));
    act(() => mockWs!.receive({ type: "compaction_end", errorMessage: "context still too large" }));
    await waitFor(() => expect(result.current.state.errors).toContain("context still too large"));
    expect(result.current.state.isCompacting).toBe(false);
  });
});

describe("the file browser", () => {
  it("keeps one entry per directory listed", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "directory_listing", requestId: "d1", path: "", entries: [{ name: "src", type: "directory" }] }));
    act(() => mockWs!.receive({ type: "directory_listing", requestId: "d2", path: "src", entries: [{ name: "main.ts", type: "file" }] }));

    await waitFor(() => expect(Object.keys(result.current.state.fileTree)).toHaveLength(2));
    expect(result.current.state.fileTree["src"]).toHaveLength(1);
  });

  it("ignores an older directory listing that arrives after its replacement", async () => {
    const result = await connected();

    act(() => result.current.listDirectory("docs"));
    const olderRequestId = lastRequestId();
    act(() => result.current.listDirectory("docs"));
    const newerRequestId = lastRequestId();

    act(() =>
      mockWs!.receive({
        type: "directory_listing",
        requestId: newerRequestId,
        path: "docs",
        entries: [{ name: "new.txt", type: "file" }],
      }),
    );
    act(() =>
      mockWs!.receive({
        type: "directory_listing",
        requestId: olderRequestId,
        path: "docs",
        entries: [{ name: "stale.txt", type: "file" }],
      }),
    );

    expect(result.current.state.fileTree["docs"]).toEqual([{ name: "new.txt", type: "file" }]);
  });

  it("ignores an old directory listing after the session root is replaced", async () => {
    const result = await connected();
    act(() => result.current.listDirectory("docs"));
    const oldRequestId = lastRequestId();

    act(() =>
      mockWs!.receive({
        type: "session_replaced",
        sessionId: "sess_2",
        branding: {},
        model: "",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        contextUsage: null,
        gitAvailable: false,
      }),
    );
    act(() =>
      mockWs!.receive({
        type: "directory_listing",
        requestId: oldRequestId,
        path: "docs",
        entries: [{ name: "old-root.txt", type: "file" }],
      }),
    );

    expect(result.current.state.sessionId).toBe("sess_2");
    expect(result.current.state.fileTree["docs"]).toBeUndefined();
  });

  it("refuses to submit a save while disconnected, since nothing would answer it", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "file_content", requestId: "x", path: "a.ts", content: "a", size: 1, mtimeMs: 1 }));
    act(() => result.current.readFile("a.ts"));
    const requestId = lastRequestId();
    act(() => mockWs!.receive({ type: "file_content", requestId, path: "a.ts", content: "a", size: 1, mtimeMs: 1 }));
    await waitFor(() => expect(result.current.state.openFile).toMatchObject({ status: "loaded" }));

    act(() => mockWs!.disconnect(1006));
    await waitFor(() => expect(result.current.state.connected).toBe(false));
    act(() => result.current.writeFile("a.ts", "b", 1));
    expect(result.current.state.openFile).not.toHaveProperty("pendingSave");
  });

  it("closes the preview on request", async () => {
    const result = await connected();
    act(() => result.current.readFile("a.ts"));
    const requestId = lastRequestId();
    act(() => mockWs!.receive({ type: "file_content", requestId, path: "a.ts", content: "a", size: 1, mtimeMs: 1 }));
    await waitFor(() => expect(result.current.state.openFile).not.toBeNull());

    act(() => result.current.closeFilePreview());
    await waitFor(() => expect(result.current.state.openFile).toBeNull());
  });
});

describe("the file-history pane", () => {
  /** Open the pane and return the requestId the hook used to ask for the log. */
  async function openHistory(result: Awaited<ReturnType<typeof connected>>) {
    act(() => result.current.fetchGitFileHistory("src/main.ts"));
    await waitFor(() => expect(result.current.state.gitFileHistory).toMatchObject({ status: "loading" }));
    return result.current.state.gitFileHistory!.requestId;
  }

  it("takes the log it asked for", async () => {
    const result = await connected();
    const requestId = await openHistory(result);
    act(() => mockWs!.receive({ type: "git_file_log", requestId, path: "src/main.ts", entries: [{ sha: "a", parents: [], author: "Ada", date: "", subject: "first", path: "src/main.ts", added: 1, deleted: 0 }] }));
    await waitFor(() => expect(result.current.state.gitFileHistory).toMatchObject({ status: "loaded" }));
    expect(result.current.state.gitFileHistory!.entries).toHaveLength(1);
  });

  it("ignores a log for a pane that has moved on", async () => {
    const result = await connected();
    await openHistory(result);
    act(() => mockWs!.receive({ type: "git_file_log", requestId: "stale", path: "other.ts", entries: [] }));
    expect(result.current.state.gitFileHistory).toMatchObject({ status: "loading" });
  });

  it("reports a failed log inside the pane rather than in the error list", async () => {
    const result = await connected();
    const requestId = await openHistory(result);
    act(() => mockWs!.receive({ type: "git_error", requestId, message: "not a git repository" }));
    await waitFor(() => expect(result.current.state.gitFileHistory).toMatchObject({ status: "error", error: "not a git repository" }));
    expect(result.current.state.errors).toHaveLength(0);
  });

  it("keeps the previous diff on screen while the next one is fetched", async () => {
    const result = await connected();
    const base = { rev: "a", path: "src/main.ts" };
    const target = { rev: "b", path: "src/main.ts" };
    act(() => result.current.fetchGitFileDiff(base, target));
    const requestId = result.current.state.gitFileDiff!.requestId;
    act(() => mockWs!.receive({ type: "git_file_diff", requestId, base, target, beforeText: "one", afterText: "two" }));
    await waitFor(() => expect(result.current.state.gitFileDiff).toMatchObject({ status: "loaded" }));

    act(() => result.current.fetchGitFileDiff(base, { rev: "c", path: "src/main.ts" }));
    // Still showing the old texts, marked as loading, so the pane dims rather than blanks
    expect(result.current.state.gitFileDiff).toMatchObject({ status: "loading", beforeText: "one", afterText: "two" });
  });

  it("drops a diff whose pair the selection has moved past", async () => {
    const result = await connected();
    const base = { rev: "a", path: "src/main.ts" };
    act(() => result.current.fetchGitFileDiff(base, { rev: "b", path: "src/main.ts" }));
    const requestId = result.current.state.gitFileDiff!.requestId;
    act(() =>
      mockWs!.receive({ type: "git_file_diff", requestId, base, target: { rev: "OTHER", path: "src/main.ts" }, beforeText: "x", afterText: "y" }),
    );
    expect(result.current.state.gitFileDiff).toMatchObject({ status: "loading" });
  });

  it("reports a failed diff inside the pane", async () => {
    const result = await connected();
    act(() => result.current.fetchGitFileDiff({ rev: "a", path: "a.ts" }, { rev: "b", path: "a.ts" }));
    const requestId = result.current.state.gitFileDiff!.requestId;
    act(() => mockWs!.receive({ type: "git_error", requestId, message: "Binary file" }));
    await waitFor(() => expect(result.current.state.gitFileDiff).toMatchObject({ status: "error", error: "Binary file" }));
    expect(result.current.state.errors).toHaveLength(0);
  });

  it("forgets everything when the pane closes", async () => {
    const result = await connected();
    await openHistory(result);
    act(() => result.current.closeGitFileHistory());
    await waitFor(() => expect(result.current.state.gitFileHistory).toBeNull());
    expect(result.current.state.gitFileDiff).toBeNull();
  });
});

describe("git errors that belong nowhere in particular", () => {
  it("land in the error list", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "git_error", requestId: "gitlog:1", message: "git is not available" }));
    await waitFor(() => expect(result.current.state.errors).toContain("git: git is not available"));
  });

  it("but a viewer diff failure lands in the viewer", async () => {
    const result = await connected();
    act(() => result.current.readFile("a.ts"));
    const readId = lastRequestId();
    act(() => mockWs!.receive({ type: "file_content", requestId: readId, path: "a.ts", content: "a", size: 1, mtimeMs: 1 }));
    await waitFor(() => expect(result.current.state.openFile).toMatchObject({ status: "loaded" }));

    act(() => result.current.fetchGitDiff("a.ts"));
    act(() => mockWs!.receive({ type: "git_error", requestId: lastRequestId(), message: "Binary file" }));
    await waitFor(() => expect(result.current.state.gitDiff).toMatchObject({ path: "a.ts", error: "Binary file" }));
    expect(result.current.state.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The outgoing commands. Each is a one-liner, but its frame is the contract the
// server validates: a wrong `type` or a missing field is refused there and shows
// up here as a button that silently does nothing.
// ---------------------------------------------------------------------------
describe("commands on the wire", () => {
  /** The last frame the hook sent, parsed. */
  function lastFrame() {
    return JSON.parse(mockWs!.sent[mockWs!.sent.length - 1]) as Record<string, unknown>;
  }

  const cases: Array<[string, (api: Awaited<ReturnType<typeof connected>>["current"]) => void, Record<string, unknown>]> = [
    ["prompt", (api) => api.prompt("hello"), { type: "prompt", text: "hello" }],
    ["prompt with images", (api) => api.prompt("look", [{ data: "AA", mimeType: "image/png" }]), { type: "prompt", text: "look", images: [{ data: "AA", mimeType: "image/png" }] }],
    ["abort", (api) => api.abort(), { type: "abort" }],
    ["setModel", (api) => api.setModel("anthropic", "opus"), { type: "set_model", provider: "anthropic", id: "opus" }],
    ["setThinking", (api) => api.setThinking("high"), { type: "set_thinking", level: "high" }],
    ["newSession", (api) => api.newSession(), { type: "new_session" }],
    ["switchSession", (api) => api.switchSession("/s/a.jsonl"), { type: "switch_session", path: "/s/a.jsonl" }],
    ["deleteSession", (api) => api.deleteSession("/s/a.jsonl"), { type: "delete_session", path: "/s/a.jsonl" }],
    ["listSessions", (api) => api.listSessions(), { type: "list_sessions" }],
    ["renameSession", (api) => api.renameSession("/s/a.jsonl", "notes"), { type: "rename_session", path: "/s/a.jsonl", name: "notes" }],
    ["listTree", (api) => api.listTree(), { type: "list_tree" }],
    ["navigateTree", (api) => api.navigateTree("e1"), { type: "navigate_tree", entryId: "e1" }],
    ["forkSession", (api) => api.forkSession("e1"), { type: "fork_session", entryId: "e1" }],
    ["editPrompt", (api) => api.editPrompt("e1", "again"), { type: "edit_prompt", entryId: "e1", text: "again" }],
    ["compact", (api) => api.compact(), { type: "compact" }],
    ["fetchGitLog", (api) => api.fetchGitLog("projA", 20), { type: "git_log", repo: "projA", limit: 20 }],
    ["fetchGitShow", (api) => api.fetchGitShow("projA", "abc1234"), { type: "git_show", repo: "projA", sha: "abc1234" }],
    ["setCredential", (api) => api.setCredential("openai", "sk-x"), { type: "set_credential", provider: "openai", apiKey: "sk-x" }],
    [
      "declareProvider",
      (api) => api.declareProvider({ provider: "corp", baseUrl: "https://x/v1", apiKey: "k", models: ["m"] }),
      { type: "declare_provider", provider: "corp", baseUrl: "https://x/v1", apiKey: "k", models: ["m"] },
    ],
    [
      "updateConfig",
      (api) => api.updateConfig({ sandbox: { root: "/w", allowWrite: true, allowBash: false }, userSkillPaths: ["/mnt/skills"] }),
      { type: "update_config", sandbox: { root: "/w", allowWrite: true, allowBash: false }, userSkillPaths: ["/mnt/skills"] },
    ],
    [
      "browseServerDirectory",
      (api) => api.browseServerDirectory("/mnt"),
      { type: "browse_server_directory", path: "/mnt" },
    ],
  ];

  for (const [name, call, expected] of cases) {
    it(`sends the right frame for ${name}`, async () => {
      const result = await connected();
      act(() => call(result.current));
      expect(lastFrame()).toMatchObject(expected);
    });
  }

  it("omits an empty image list rather than sending one", async () => {
    const result = await connected();
    act(() => result.current.prompt("hello", []));
    expect(lastFrame()).not.toHaveProperty("images");
  });

  it("omits the limit when none was asked for", async () => {
    const result = await connected();
    act(() => result.current.fetchGitLog(""));
    expect(lastFrame()).not.toHaveProperty("limit");
  });

  it("answers a dialog and pops it from the queue", async () => {
    const result = await connected();
    act(() =>
      mockWs!.receive({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Proceed?", message: "Really?" }),
    );
    await waitFor(() => expect(result.current.state.dialogQueue).toHaveLength(1));

    act(() => result.current.respondToDialog({ id: "d1", confirmed: true }));
    expect(lastFrame()).toMatchObject({ type: "extension_ui_response", id: "d1", confirmed: true });
    await waitFor(() => expect(result.current.state.dialogQueue).toHaveLength(0));
  });

  it("searches sessions and files under their own request ids", async () => {
    const result = await connected();
    act(() => result.current.searchSessions("parser"));
    expect(lastFrame()).toMatchObject({ type: "search_sessions", query: "parser" });
    expect(result.current.state.sessionSearch).toMatchObject({ status: "loading", query: "parser" });

    act(() => result.current.searchFiles("main"));
    expect(lastFrame()).toMatchObject({ type: "search_files", query: "main" });
    expect(result.current.state.fileSearch).toMatchObject({ status: "loading", query: "main" });
  });

  it("clears each search locally, without asking the server", async () => {
    const result = await connected();
    act(() => result.current.searchSessions("parser"));
    act(() => result.current.searchFiles("main"));
    const before = mockWs!.sent.length;

    act(() => result.current.clearSessionSearch());
    act(() => result.current.clearFileSearch());
    expect(mockWs!.sent).toHaveLength(before);
    expect(result.current.state.sessionSearch).toBeNull();
    expect(result.current.state.fileSearch).toBeNull();
  });

  it("dismisses a notification locally", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "extension_ui_request", id: "n1", method: "notify", message: "done" }));
    await waitFor(() => expect(result.current.state.notifications).toHaveLength(1));
    const id = result.current.state.notifications[0].id;

    act(() => result.current.dismissNotification(id));
    await waitFor(() => expect(result.current.state.notifications).toHaveLength(0));
  });
});

// ---------------------------------------------------------------------------
// Directory watching: the tree follows the disk, whoever moved it
// ---------------------------------------------------------------------------
describe("directory_changed", () => {
  /** Expand `path` and answer the listing, so the tree is actually holding it. */
  async function withExpanded(paths: string[]) {
    const result = await connected();
    for (const path of paths) {
      act(() => result.current.listDirectory(path));
      act(() =>
        mockWs!.receive({
          type: "directory_listing",
          requestId: lastRequestId(),
          path,
          entries: [{ name: "existing.txt", type: "file" }],
        }),
      );
    }
    await waitFor(() => expect(result.current.state.fileTree[paths[paths.length - 1]!]).toBeDefined());
    return result;
  }

  const sentSince = (from: number) => mockWs!.sent.slice(from).map((raw) => JSON.parse(raw) as Record<string, unknown>);

  it("re-lists a directory the tree is holding", async () => {
    const result = await withExpanded(["docs"]);
    const before = mockWs!.sent.length;

    act(() => mockWs!.receive({ type: "directory_changed", path: "docs" }));

    expect(sentSince(before)).toContainEqual(expect.objectContaining({ type: "list_directory", path: "docs" }));
  });

  it("keeps a refreshed directory's entries on screen instead of blanking it", async () => {
    // Regression, and one only the running app produced: dispatching "loading"
    // here unmounts the directory's rows, and a row's expanded state is its own —
    // so re-listing the root collapsed the whole tree and lost the user's place,
    // while the wire traffic looked perfect. Entries stay until the new ones land.
    const result = await withExpanded(["", "docs"]);

    act(() => mockWs!.receive({ type: "directory_changed", path: "" }));
    expect(result.current.state.fileTree[""]).toEqual([{ name: "existing.txt", type: "file" }]);

    act(() => result.current.refreshFileTree());
    expect(result.current.state.fileTree[""]).toEqual([{ name: "existing.txt", type: "file" }]);
    expect(result.current.state.fileTree["docs"]).toEqual([{ name: "existing.txt", type: "file" }]);
  });

  it("does show loading when the directory has nothing to keep showing", async () => {
    const result = await connected();
    act(() => result.current.listDirectory("docs"));
    act(() =>
      mockWs!.receive({ type: "file_browser_error", requestId: lastRequestId(), path: "docs", message: "gone" }),
    );
    await waitFor(() => expect(result.current.state.fileTree["docs"]).toHaveProperty("error"));

    // Retrying a directory that errored has no stale rows to preserve, so the
    // placeholder is the honest thing to show.
    act(() => result.current.refreshFileTree());
    expect(result.current.state.fileTree["docs"]).toBe("loading");
  });

  it("ignores a directory the tree never expanded", async () => {
    // The server watches every directory ever listed, including ones since
    // collapsed — and it has no idea what this client is displaying. Deciding
    // here is what keeps a collapsed branch from costing a round trip.
    await withExpanded(["docs"]);
    const before = mockWs!.sent.length;

    act(() => mockWs!.receive({ type: "directory_changed", path: "never-opened" }));

    expect(sentSince(before)).not.toContainEqual(expect.objectContaining({ type: "list_directory", path: "never-opened" }));
  });

  it("re-reads the open preview when its own directory changed", async () => {
    const result = await connected();
    act(() => result.current.readFile("docs/note.md"));
    act(() =>
      mockWs!.receive({ type: "file_content", requestId: lastRequestId(), path: "docs/note.md", content: "old", size: 3, mtimeMs: 1 }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));
    const before = mockWs!.sent.length;

    // The watcher names the directory, not the entry, so the file the viewer is
    // showing may well be the thing that moved.
    act(() => mockWs!.receive({ type: "directory_changed", path: "docs" }));

    expect(sentSince(before)).toContainEqual(expect.objectContaining({ type: "read_file", path: "docs/note.md" }));
  });

  it("keeps the open preview's content on screen while its directory's re-read is in flight", async () => {
    // Same regression as the file tree's "keeps a refreshed directory's entries on
    // screen" test above: flipping openFile to "loading" for this re-read unmounts
    // the rendered markdown for the length of the round trip, on every directory
    // event — chatty on Windows, where a single write can fire several.
    const result = await connected();
    act(() => result.current.readFile("docs/note.md"));
    act(() =>
      mockWs!.receive({ type: "file_content", requestId: lastRequestId(), path: "docs/note.md", content: "old", size: 3, mtimeMs: 1 }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));

    act(() => mockWs!.receive({ type: "directory_changed", path: "docs" }));
    expect(result.current.state.openFile).toMatchObject({ status: "loaded", path: "docs/note.md", content: "old" });

    act(() =>
      mockWs!.receive({
        type: "file_content",
        requestId: lastRequestId(),
        path: "docs/note.md",
        content: "new",
        size: 3,
        mtimeMs: 2,
      }),
    );
    expect(result.current.state.openFile).toMatchObject({ status: "loaded", content: "new" });
  });

  it("invalidates a raw PDF preview when its directory changed", async () => {
    const result = await connected();
    act(() => result.current.readFile("docs/report.pdf"));
    act(() =>
      mockWs!.receive({
        type: "file_browser_error",
        requestId: lastRequestId(),
        path: "docs/report.pdf",
        message: "Binary file — preview not supported",
      }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("error"));
    const before = result.current.state.previewRevision;

    act(() => mockWs!.receive({ type: "directory_changed", path: "docs" }));

    expect(result.current.state.previewRevision).toBe(before + 1);
  });

  it("leaves a preview alone when some other directory changed", async () => {
    const result = await connected();
    act(() => result.current.readFile("docs/note.md"));
    act(() =>
      mockWs!.receive({ type: "file_content", requestId: lastRequestId(), path: "docs/note.md", content: "old", size: 3, mtimeMs: 1 }),
    );
    await waitFor(() => expect(result.current.state.openFile?.status).toBe("loaded"));
    const before = mockWs!.sent.length;

    act(() => mockWs!.receive({ type: "directory_changed", path: "elsewhere" }));

    expect(sentSince(before)).not.toContainEqual(expect.objectContaining({ type: "read_file" }));
  });

  it("re-lists every held directory on a manual refresh", async () => {
    const result = await withExpanded(["", "docs", "docs/deep"]);
    const before = mockWs!.sent.length;

    act(() => result.current.refreshFileTree());

    const sent = sentSince(before);
    for (const path of ["", "docs", "docs/deep"]) {
      expect(sent).toContainEqual(expect.objectContaining({ type: "list_directory", path }));
    }
  });

  it("still asks for the root on refresh when the tree came up empty", async () => {
    // The reconnect bug: a fresh `hello` clears `fileTree` while the sidebar is
    // open, so the old refresh — which only re-listed directories the tree was
    // already holding — had nothing to iterate and did nothing at all. A browser
    // reload was the only way back. The root is now always re-requested.
    const result = await connected();
    const before = mockWs!.sent.length;

    act(() => result.current.refreshFileTree());

    expect(sentSince(before)).toContainEqual(expect.objectContaining({ type: "list_directory", path: "" }));
    // ...and nothing else: there are no held directories to re-list.
    expect(sentSince(before).filter((frame) => frame.type === "list_directory")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Keeping the file-browser root alive across reconnects and session snapshots.
//
// The rare-but-painful bug: the sidebar requested the root once, from its mount
// effect. Every WebSocket (re)connect answers with a `hello`, and applySnapshot
// clears `fileTree` — so a drop while the sidebar was open left the tree empty,
// the refresh button (held-directories only) unable to recover it, and a browser
// page reload the only way back.
// ---------------------------------------------------------------------------
describe("file-browser root across snapshots", () => {
  const helloFrame = (overrides: Record<string, unknown> = {}) => ({
    type: "hello",
    sessionId: "sess_2",
    branding: {},
    model: "",
    thinkingLevel: "off",
    models: [],
    commands: [],
    isStreaming: false,
    items: [],
    contextUsage: null,
    gitAvailable: false,
    ...overrides,
  });
  const sentSince = (from: number) => mockWs!.sent.slice(from).map((raw) => JSON.parse(raw) as Record<string, unknown>);
  const answerRootListing = () =>
    act(() =>
      mockWs!.receive({
        type: "directory_listing",
        requestId: lastRequestId(),
        path: "",
        entries: [{ name: "readme.md", type: "file" }],
      }),
    );

  it("re-requests the root on its own when a reconnect snapshot clears the tree", async () => {
    const result = await connected();

    // The sidebar's first open asks for the root; the server answers it.
    act(() => result.current.listDirectory(""));
    answerRootListing();
    await waitFor(() => expect(result.current.state.fileTree[""]).toHaveLength(1));

    // A reconnect delivers a fresh hello and applySnapshot wipes the tree — but
    // the hook re-asks for the root on its own, so it lands straight on "loading"
    // rather than staying blank until someone touches the refresh button.
    const before = mockWs!.sent.length;
    act(() => mockWs!.receive(helloFrame()));
    expect(result.current.state.fileTree[""]).toBe("loading");
    expect(sentSince(before)).toContainEqual(expect.objectContaining({ type: "list_directory", path: "" }));

    // ...and the tree fills back in once the answer lands.
    answerRootListing();
    await waitFor(() => expect(result.current.state.fileTree[""]).toHaveLength(1));
  });

  it("recovers the root after a workspace switch clears the tree with the sidebar open", async () => {
    const result = await connected();
    act(() => result.current.listDirectory(""));
    answerRootListing();
    await waitFor(() => expect(result.current.state.fileTree[""]).toHaveLength(1));

    const before = mockWs!.sent.length;
    act(() =>
      mockWs!.receive(
        helloFrame({
          type: "workspace_switched",
          sessionId: "session-beta",
          workspace: { root: "/srv/beta", name: "beta", activity: "idle", needsAttention: false },
        }),
      ),
    );

    // The switched-to project's root is requested on its own — only session_replaced
    // used to do this, so an open sidebar went blank until a manual refresh.
    expect(result.current.state.fileTree[""]).toBe("loading");
    expect(sentSince(before)).toContainEqual(expect.objectContaining({ type: "list_directory", path: "" }));
  });

  it("stays lazy: never asks for the root when the sidebar was never opened", async () => {
    const result = await connected();
    const before = mockWs!.sent.length;

    // Two more snapshots, as reconnects and a config reload would deliver them.
    act(() => mockWs!.receive(helloFrame()));
    act(() => mockWs!.receive(helloFrame({ sessionId: "sess_3" })));
    await waitFor(() => expect(result.current.state.sessionId).toBe("sess_3"));

    expect(sentSince(before)).not.toContainEqual(expect.objectContaining({ type: "list_directory" }));
  });

  it("fires once per gap, not in a loop", async () => {
    const result = await connected();
    act(() => result.current.listDirectory(""));
    answerRootListing();
    await waitFor(() => expect(result.current.state.fileTree[""]).toHaveLength(1));

    const before = mockWs!.sent.length;
    act(() => mockWs!.receive(helloFrame()));
    await waitFor(() =>
      expect(sentSince(before).filter((frame) => frame.type === "list_directory")).toHaveLength(1),
    );
    // `dir_list_started` marks the entry "loading"; the effect must not re-fire
    // on that state change.
    await waitFor(() => expect(result.current.state.fileTree[""]).toBe("loading"));
    expect(sentSince(before).filter((frame) => frame.type === "list_directory")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Settings: server-directory browsing and the apply that must be persisted
// ---------------------------------------------------------------------------
describe("server path browsing", () => {
  it("holds the listing the server answered with", async () => {
    const result = await connected();
    act(() => result.current.browseServerDirectory("/mnt"));
    expect(result.current.state.serverBrowse?.status).toBe("loading");

    act(() =>
      mockWs!.receive({
        type: "server_directory",
        requestId: lastRequestId(),
        path: "/mnt",
        parent: "/",
        entries: [{ name: "skills", path: "/mnt/skills" }],
      }),
    );

    expect(result.current.state.serverBrowse).toMatchObject({
      status: "loaded",
      path: "/mnt",
      parent: "/",
      entries: [{ name: "skills", path: "/mnt/skills" }],
    });
  });

  it("ignores an answer to a browse the user has moved past", async () => {
    const result = await connected();
    act(() => result.current.browseServerDirectory("/mnt"));
    const stale = lastRequestId();
    act(() => result.current.browseServerDirectory("/srv"));
    const current = lastRequestId();

    act(() =>
      mockWs!.receive({ type: "server_directory", requestId: stale, path: "/mnt", parent: "/", entries: [{ name: "old", path: "/mnt/old" }] }),
    );

    // Still waiting on the browse the user actually asked for.
    expect(result.current.state.serverBrowse).toMatchObject({ status: "loading", requestId: current });
    expect(result.current.state.serverBrowse?.entries).toEqual([]);

    act(() =>
      mockWs!.receive({ type: "server_directory", requestId: current, path: "/srv", parent: "/", entries: [{ name: "new", path: "/srv/new" }] }),
    );
    expect(result.current.state.serverBrowse).toMatchObject({ status: "loaded", path: "/srv" });
  });

  it("keeps the directory on screen when the next one cannot be read", async () => {
    const result = await connected();
    act(() => result.current.browseServerDirectory("/"));
    act(() =>
      mockWs!.receive({
        type: "server_directory",
        requestId: lastRequestId(),
        path: "/",
        parent: null,
        entries: [{ name: "private", path: "/private" }],
      }),
    );
    act(() => result.current.browseServerDirectory("/private"));
    act(() =>
      mockWs!.receive({
        type: "server_directory_error",
        requestId: lastRequestId(),
        path: "/private",
        message: 'Cannot list "/private": permission denied',
      }),
    );

    expect(result.current.state.serverBrowse?.status).toBe("error");
    expect(result.current.state.serverBrowse?.error).toMatch(/permission denied/);
    expect(result.current.state.serverBrowse?.entries).toEqual([{ name: "private", path: "/private" }]);
    // Path and entries stay the same directory: otherwise "Use this directory"
    // would offer the path the server just refused to read.
    expect(result.current.state.serverBrowse?.path).toBe("/");
  });

  it("drops the listing when the picker is closed", async () => {
    const result = await connected();
    act(() => result.current.browseServerDirectory("/"));
    act(() => result.current.closeServerBrowser());
    expect(result.current.state.serverBrowse).toBeNull();
  });
});

describe("applying settings", () => {
  it("stays in flight until the server acknowledges a persisted change", async () => {
    const result = await connected();
    act(() => result.current.updateConfig({ userSkillPaths: ["/mnt/skills"] }));
    expect(result.current.state.settingsApply).toEqual({ status: "applying" });

    act(() =>
      mockWs!.receive({
        type: "update_config_ack",
        sessionId: "sess_2",
        branding: {},
        model: "",
        thinkingLevel: "off",
        models: [],
        commands: [],
        isStreaming: false,
        items: [],
        userSkillPaths: ["/mnt/skills"],
      }),
    );

    expect(result.current.state.settingsApply).toBeNull();
    expect(result.current.state.userSkillPaths).toEqual(["/mnt/skills"]);
  });

  it("carries the server's refusal back to the settings menu", async () => {
    const result = await connected();
    act(() => result.current.updateConfig({ userSkillPaths: ["/mnt/skills"] }));
    act(() => mockWs!.receive({ type: "error", message: "cannot save /etc/pi.json: read-only file system" }));

    expect(result.current.state.settingsApply).toEqual({
      status: "error",
      message: "cannot save /etc/pi.json: read-only file system",
    });
    // The configured paths are still the server's — nothing was applied.
    expect(result.current.state.userSkillPaths).toEqual([]);
  });

  it("leaves an unrelated error alone when no apply is waiting", async () => {
    const result = await connected();
    act(() => mockWs!.receive({ type: "error", message: "something else broke" }));
    expect(result.current.state.settingsApply).toBeNull();
    expect(result.current.state.errors).toEqual(["something else broke"]);
  });
});

describe("integrated terminal in useAgent", () => {
  const sentSince = (from: number) => mockWs!.sent.slice(from).map((raw) => JSON.parse(raw) as Record<string, unknown>);

  it("sends terminal wire messages and notifies listeners", async () => {
    const result = await connected();
    let before = mockWs!.sent.length;

    // openTerminal
    act(() => result.current.openTerminal("term-1", "/test/dir", 80, 24));
    expect(sentSince(before)).toContainEqual({
      type: "terminal_open",
      terminalId: "term-1",
      cwd: "/test/dir",
      cols: 80,
      rows: 24,
    });

    // sendTerminalInput
    before = mockWs!.sent.length;
    act(() => result.current.sendTerminalInput("term-1", "ls -la\n"));
    expect(sentSince(before)).toContainEqual({
      type: "terminal_input",
      terminalId: "term-1",
      data: "ls -la\n",
    });

    // getTerminalCwd
    before = mockWs!.sent.length;
    act(() => result.current.getTerminalCwd("term-1"));
    expect(sentSince(before)).toContainEqual({
      type: "terminal_get_cwd",
      terminalId: "term-1",
    });

    // resizeTerminal
    before = mockWs!.sent.length;
    act(() => result.current.resizeTerminal("term-1", 120, 40));
    expect(sentSince(before)).toContainEqual({
      type: "terminal_resize",
      terminalId: "term-1",
      cols: 120,
      rows: 40,
    });

    // subscribeTerminal
    const onData = vi.fn();
    const onCwd = vi.fn();
    const onExit = vi.fn();
    const onError = vi.fn();

    const unsubscribe = result.current.subscribeTerminal("term-1", {
      onData,
      onCwd,
      onExit,
      onError,
    });

    // Receive server events
    act(() => mockWs!.receive({ type: "terminal_data", terminalId: "term-1", data: "output text\n" }));
    expect(onData).toHaveBeenCalledWith("output text\n");

    act(() => mockWs!.receive({ type: "terminal_cwd", terminalId: "term-1", cwd: "/test/sub" }));
    expect(onCwd).toHaveBeenCalledWith("/test/sub");

    act(() => mockWs!.receive({ type: "terminal_exit", terminalId: "term-1", exitCode: 0 }));
    expect(onExit).toHaveBeenCalledWith(0);

    act(() => mockWs!.receive({ type: "terminal_error", terminalId: "term-1", message: "pty error" }));
    expect(onError).toHaveBeenCalledWith("pty error");

    // Unsubscribe
    act(() => unsubscribe());

    // closeTerminal
    before = mockWs!.sent.length;
    act(() => result.current.closeTerminal("term-1"));
    expect(sentSince(before)).toContainEqual({
      type: "terminal_close",
      terminalId: "term-1",
    });
  });
});
