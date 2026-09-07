import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import type { RuntimeEvent } from "../src/agentRuntime.ts";
import { EmbeddedRuntime } from "../src/embeddedRuntime.ts";

describe("EmbeddedRuntime tool rebuilding", () => {
  it("retains the replacement factory when extension binding fails after the session switched", async () => {
    const oldFactory = (async () => undefined) as unknown as CreateAgentSessionRuntimeFactory;
    const newFactory = (async () => undefined) as unknown as CreateAgentSessionRuntimeFactory;
    let currentFactory = oldFactory;
    let attempt = 0;
    const factoriesUsed: CreateAgentSessionRuntimeFactory[] = [];

    const makeSession = (bindFails: boolean) => ({
      subscribe: () => () => {},
      bindExtensions: async () => {
        if (bindFails) throw new Error("extension bind failed");
      },
    });
    let session = makeSession(false);
    const sdkRuntime = {
      get session() {
        return session;
      },
      async newSession() {
        factoriesUsed.push(currentFactory);
        attempt += 1;
        session = makeSession(attempt === 1);
        return { cancelled: false };
      },
    };
    const runtime = new EmbeddedRuntime(sdkRuntime as never, "/nowhere", (factory) => {
      const previous = currentFactory;
      currentFactory = factory;
      return previous;
    });

    await assert.rejects(runtime.rebuildTools(newFactory), /extension bind failed/);
    assert.equal(currentFactory, newFactory, "the installed session stays paired with its factory");

    await runtime.rebuildTools();
    assert.deepEqual(factoriesUsed, [newFactory, newFactory], "the next session still uses the replacement factory");
  });
});

/** Poll rather than count ticks: the binding settles through promise callbacks, not a fixed number of them. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Collects the warnings the runtime prints, so a test can read them instead of the operator. */
function captureWarnings(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => (console.warn = original) };
}

describe("EmbeddedRuntime startup binding", () => {
  it("stops waiting on extensions that outlive the grace, and reports them when they land", async () => {
    let release: () => void = () => {};
    const session = {
      subscribe: () => () => {},
      bindExtensions: async () => {
        await new Promise<void>((resolve) => (release = resolve));
      },
    };
    const runtime = new EmbeddedRuntime({ get session() { return session; } } as never, "/nowhere");
    const warnings = captureWarnings();
    try {
      await runtime.bind({ graceMs: 10 });
    } finally {
      warnings.restore();
    }
    assert.match(warnings.lines.join("\n"), /extensions have not bound/, "the operator is told the interface came up without them");

    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    release();
    await waitFor(() => events.some((event) => event.type === "extensions_bound"), "the late binding to be announced");
    const bound = events.find((event) => event.type === "extensions_bound");
    assert.ok(bound && bound.type === "extensions_bound" && bound.elapsedMs >= 0, "the announcement carries how long it took");
  });

  it("replays a dialog raised before anything subscribed", async () => {
    const session = {
      subscribe: () => () => {},
      bindExtensions: async (bindings: { uiContext: { confirm: (title: string, message: string) => Promise<boolean> } }) => {
        // What a `session_start` handler does when it wants an answer: the promise
        // stays pending until a client sends one back.
        await bindings.uiContext.confirm("Reload openlore?", "The index is stale");
      },
    };
    const runtime = new EmbeddedRuntime({ get session() { return session; } } as never, "/nowhere");
    const warnings = captureWarnings();
    try {
      await runtime.bind({ graceMs: 10 });
    } finally {
      warnings.restore();
    }

    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    const asked = events.find((event) => event.type === "extension_ui_request");
    assert.ok(asked && asked.type === "extension_ui_request", "the question survived having no audience");
    assert.equal(asked.request.method, "confirm");
    assert.equal(asked.request.title, "Reload openlore?");
  });

  it("keeps a binding failure inside the grace fatal, and a later one merely reported", async () => {
    const immediate = {
      subscribe: () => () => {},
      bindExtensions: async () => {
        throw new Error("extension bind failed");
      },
    };
    const fatal = new EmbeddedRuntime({ get session() { return immediate; } } as never, "/nowhere");
    await assert.rejects(fatal.bind({ graceMs: 50 }), /extension bind failed/, "a fast failure still stops startup");

    let fail: (error: Error) => void = () => {};
    const late = {
      subscribe: () => () => {},
      bindExtensions: async () => {
        await new Promise<void>((_resolve, reject) => (fail = reject));
      },
    };
    const runtime = new EmbeddedRuntime({ get session() { return late; } } as never, "/nowhere");
    const warnings = captureWarnings();
    try {
      await runtime.bind({ graceMs: 10 });
    } finally {
      warnings.restore();
    }
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    fail(new Error("openlore never answered"));
    await waitFor(() => events.some((event) => event.type === "error"), "the late failure to be reported");
    const reported = events.find((event) => event.type === "error");
    assert.match(reported && reported.type === "error" ? reported.message : "", /openlore never answered/);
  });
});
