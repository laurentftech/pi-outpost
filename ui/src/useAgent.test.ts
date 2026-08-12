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
async function connected(items: unknown[] = []) {
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
        branch: "main",
        ahead: 1,
        behind: 0,
        files: [{ path: "a.ts", status: "modified" }],
      }),
    );

    await waitFor(() => expect(result.current.state.gitStatus?.files["a.ts"]).toBe("modified"));
    expect(result.current.state.gitStatus?.branch).toBe("main");
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
});
