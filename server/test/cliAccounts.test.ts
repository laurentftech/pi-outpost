import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runCliProviderLogin, runCliProviderLogout, type CliAccountRuntime } from "../src/cliAccounts.ts";

describe("TerminalSignInAndOut", () => {
  test("runs the account sign-in prompts and signs out only the stored credential", async () => {
    const stored = new Set<string>();
    const environment = new Set(["openai"]);
    const fake: CliAccountRuntime = {
      getProviders: () => [{ id: "openai", auth: { oauth: true } }],
      async login(providerId, method, options) {
        assert.equal(method, "oauth");
        options.notify({ type: "device_code", verificationUri: "https://example.test/device", userCode: "ABCD" });
        const code = await options.prompt({ type: "manual_code", message: "Paste code" });
        if (code !== "right-code") throw new Error("wrong code");
        stored.add(providerId);
      },
      async logout(providerId) { stored.delete(providerId); },
    };
    const notices: unknown[] = [];
    const accepted = await runCliProviderLogin(fake, "openai", {
      signal: new AbortController().signal,
      notify: (event) => notices.push(event),
      prompt: async () => "right-code",
      getDeviceId: () => "device-1",
    });
    assert.equal(accepted, true);
    assert.deepEqual(notices, [{ type: "device_code", verificationUri: "https://example.test/device", userCode: "ABCD" }]);
    assert.deepEqual([...stored], ["openai"]);
    await runCliProviderLogout(fake, "openai");
    assert.deepEqual([...stored], []);
    assert.deepEqual([...environment], ["openai"]);
  });

  test("reports wrong codes and unsupported login methods", async () => {
    const fake: CliAccountRuntime = {
      getProviders: () => [{ id: "plain", auth: {} }, { id: "oauth", auth: { oauth: true } }],
      async login(_provider, _method, options) {
        const code = await options.prompt({ type: "manual_code", message: "Paste code" });
        if (code !== "right-code") throw new Error("wrong code");
      },
      async logout() {},
    };
    const base = { signal: new AbortController().signal, notify: () => {}, prompt: async () => "wrong-code" };
    assert.equal(await runCliProviderLogin(fake, "plain", base), false);
    await assert.rejects(runCliProviderLogin(fake, "oauth", base), /wrong code/);
    await assert.rejects(runCliProviderLogout(fake, "missing"), /unknown provider/);
  });
});
