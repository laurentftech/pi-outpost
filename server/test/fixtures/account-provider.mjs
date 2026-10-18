/**
 * A provider that is signed in to with an account only, for driving the sign-in relay end to end.
 *
 * Its flow does what real ones do: shows a device code and the address to enter it at, then asks
 * for a code to paste (the fallback of a flow waiting for a loopback redirect). "right-code" signs
 * in; anything else fails the flow, as a wrong code would. A model answers "ok" once signed in.
 */
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

function stream(model) {
  const out = createAssistantMessageEventStream();
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    out.push({ type: "done", reason: "stop", message });
  });
  return out;
}

export default function (pi) {
  pi.registerProvider("account-test", {
    name: "Account Test",
    baseUrl: "http://127.0.0.1",
    api: "account-test-api",
    oauth: {
      name: "Account Test",
      isSubscription: true,
      async login(callbacks) {
        callbacks.onDeviceCode({ userCode: "WDJB-MJHT", verificationUri: "https://example.test/device", expiresInSeconds: 600 });
        callbacks.onProgress("Waiting for the code");
        const code = await callbacks.onManualCodeInput();
        if (code !== "right-code") throw new Error("That code was not accepted");
        return { access: "account-test-token-SECRET", refresh: "account-test-refresh-SECRET", expires: Date.now() + 3_600_000 };
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    },
    models: [{
      id: "account-test-model",
      name: "Account Test Model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
