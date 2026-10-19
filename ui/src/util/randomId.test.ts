import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./randomId";

describe("randomId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "native-uuid" });

    expect(randomId()).toBe("native-uuid");
  });

  it("creates a UUID with getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });

    expect(randomId()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
