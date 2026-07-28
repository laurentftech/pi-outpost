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
