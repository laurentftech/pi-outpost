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
    ["fetchGitLog", (api) => api.fetchGitLog(20), { type: "git_log", limit: 20 }],
    ["fetchGitShow", (api) => api.fetchGitShow("abc1234"), { type: "git_show", sha: "abc1234" }],
    ["setCredential", (api) => api.setCredential("openai", "sk-x"), { type: "set_credential", provider: "openai", apiKey: "sk-x" }],
    [
      "declareProvider",
      (api) => api.declareProvider({ provider: "corp", baseUrl: "https://x/v1", apiKey: "k", models: ["m"] }),
      { type: "declare_provider", provider: "corp", baseUrl: "https://x/v1", apiKey: "k", models: ["m"] },
    ],
    [
      "updateConfig",
      (api) => api.updateConfig({ root: "/w", allowWrite: true, allowBash: false }),
      { type: "update_config", sandbox: { root: "/w", allowWrite: true, allowBash: false } },
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
    act(() => result.current.fetchGitLog());
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
