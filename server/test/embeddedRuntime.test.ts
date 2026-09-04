import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
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
