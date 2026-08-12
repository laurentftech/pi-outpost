/**
 * The two validators that stand between client frames and the credential store.
 *
 * `set_credential` and `declare_provider` arrive over the WebSocket, and a
 * provider id becomes a key in auth.json / models.json while a base URL becomes
 * a host the server will send API keys to. The integration test in
 * credentials.test.mjs covers the happy path through the socket; these pin the
 * boundary itself, where a rejection is the whole feature.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { tlsHint, validBaseUrl, validProviderId } from "../src/credentials.ts";

describe("validProviderId", () => {
  test("accepts the shapes real providers use", () => {
    for (const id of ["openai", "anthropic", "my-gateway", "vllm.local", "ollama_2", "A1", "x"]) {
      assert.equal(validProviderId(id), true, `${id} should be accepted`);
    }
  });

  test("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, [], true, Symbol("x")]) {
      assert.equal(validProviderId(value), false, `${String(value)} should be refused`);
    }
  });

  test("refuses an empty id", () => {
    assert.equal(validProviderId(""), false);
  });

  test("refuses an id that does not start alphanumerically", () => {
    // A leading dot or dash is what a path-traversal attempt looks like here
    for (const id of [".hidden", "-flag", "_under", "./relative", "../escape"]) {
      assert.equal(validProviderId(id), false, `${id} should be refused`);
    }
  });

  test("refuses separators, so an id can never become a path", () => {
    for (const id of ["a/b", "a\\b", "a b", "a:b", "a\0b", "a\nb"]) {
      assert.equal(validProviderId(id), false, `${JSON.stringify(id)} should be refused`);
    }
  });

  test("caps the length at 64 characters", () => {
    assert.equal(validProviderId("a".repeat(64)), true);
    assert.equal(validProviderId("a".repeat(65)), false);
  });
});

describe("validBaseUrl", () => {
  test("accepts http and https endpoints", () => {
    for (const url of ["http://localhost:11434", "https://api.example.com", "https://gw.corp/v1/", "http://127.0.0.1:8000/v1"]) {
      assert.equal(validBaseUrl(url), true, `${url} should be accepted`);
    }
  });

  test("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, []]) {
      assert.equal(validBaseUrl(value), false, `${String(value)} should be refused`);
    }
  });

  test("refuses a string that is not a URL at all", () => {
    for (const url of ["", "   ", "not a url", "example.com", "//example.com"]) {
      assert.equal(validBaseUrl(url), false, `${JSON.stringify(url)} should be refused`);
    }
  });

  test("refuses schemes that are not http(s)", () => {
    // file: and data: would make the server read local bytes; javascript: is
    // meaningless here but must not slip through either
    for (const url of ["file:///etc/passwd", "data:text/plain,hi", "javascript:alert(1)", "ftp://example.com", "ws://example.com"]) {
      assert.equal(validBaseUrl(url), false, `${url} should be refused`);
    }
  });
});

describe("tlsHint", () => {
  test("recognises a TLS failure by error code", () => {
    const hint = tlsHint({ code: "SELF_SIGNED_CERT_IN_CHAIN" });
    assert.match(hint ?? "", /NODE_EXTRA_CA_CERTS/);
    assert.match(hint ?? "", /SELF_SIGNED_CERT_IN_CHAIN/);
  });

  test("recognises one nested in a cause chain", () => {
    const hint = tlsHint(Object.assign(new Error("fetch failed"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }));
    assert.match(hint ?? "", /TLS certificate/);
  });

  test("recognises one named only in the message", () => {
    assert.ok(tlsHint(new Error("request to https://gw failed: DEPTH_ZERO_SELF_SIGNED_CERT")));
  });

  test("says nothing about an unrelated error", () => {
    assert.equal(tlsHint(new Error("ECONNREFUSED")), undefined);
    assert.equal(tlsHint(undefined), undefined);
    assert.equal(tlsHint(null), undefined);
  });

  test("does not loop forever on a cyclic cause chain", () => {
    const error: { code: string; cause?: unknown } = { code: "NOPE" };
    error.cause = error;
    assert.equal(tlsHint(error), undefined);
  });
});
