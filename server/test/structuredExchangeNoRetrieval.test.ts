/**
 * Validation reads the document and nothing else.
 *
 * The enriched contract lets a producer put three kinds of address in an envelope:
 * a profile naming the vocabulary, locations pointing at source, and artifact links
 * bound to a digest. Every one of them is producer-controlled text, and every one
 * of them would be a request if anything resolved it — which would make validating
 * a document an act with a network side effect, performed on data the application
 * was asked to judge rather than to trust.
 *
 * Asserted at the real boundary rather than by reading the code: the module-level
 * hooks for the network and the filesystem are replaced with ones that fail on
 * contact, and a document dense with addresses is validated through them. A future
 * change that resolves a profile "just to check it exists" fails here.
 */
import assert from "node:assert/strict";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { describe, test } from "node:test";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  STRUCTURED_EXCHANGE_SCHEMA_V2,
  STRUCTURED_EXCHANGE_CEILINGS_2,
} from "@pi-outpost/shared/structured-exchange";

const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

/**
 * A document that names as many outside things as the contract allows, in every
 * place it allows them.
 */
const addressed = {
  schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
  kind: "table",
  profile: "https://vocabulary.example.invalid/requirements/v3",
  target: { ref: "DOC-1", revision: "rev-9" },
  artifacts: [
    {
      rel: "specification",
      uri: "https://artifacts.example.invalid/spec.pdf",
      sha256: digest("a"),
      mediaType: "application/pdf",
    },
  ],
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      {
        id: "r1",
        ref: "REQ-1",
        kind: "requirement",
        cells: ["REQ-1", "Stop within 40 m"],
        attributes: { source: { ref: "https://models.example.invalid/EL-7" } },
        expect: { label: "Stop within 40 m", revision: "rev-9" },
        locations: [
          { uri: "https://source.example.invalid/brakes.md", revision: "abc123", range: { startLine: 1, endLine: 4 } },
          { uri: "file:///etc/passwd" },
        ],
        artifacts: [
          { rel: "verifies", uri: "http://ci.example.invalid/report.json", sha256: digest("b") },
          { rel: "evidence", uri: "file:///var/secrets/token", sha256: digest("c") },
        ],
      },
    ],
    relations: [{ from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }],
  },
};

/**
 * Every way out of the process that validation could plausibly take, replaced with
 * one that records the attempt and throws. Restored whatever the test does.
 */
function withSealedBoundaries<T>(body: () => T): { result: T; attempts: string[] } {
  const attempts: string[] = [];
  const seal = <O extends object, K extends keyof O>(host: O, key: K, label: string) => {
    const original = host[key];
    (host as Record<string, unknown>)[key as string] = (...args: unknown[]) => {
      attempts.push(`${label}(${String(args[0]).slice(0, 80)})`);
      throw new Error(`validation reached out: ${label}`);
    };
    return () => {
      (host as Record<string, unknown>)[key as string] = original;
    };
  };

  const restores = [
    seal(globalThis as unknown as { fetch: unknown }, "fetch" as never, "fetch"),
    seal(http, "get" as never, "http.get"),
    seal(http, "request" as never, "http.request"),
    seal(https, "get" as never, "https.get"),
    seal(https, "request" as never, "https.request"),
    seal(net, "connect" as never, "net.connect"),
    seal(dns, "lookup" as never, "dns.lookup"),
    seal(fs, "readFileSync" as never, "fs.readFileSync"),
    seal(fs, "openSync" as never, "fs.openSync"),
    seal(fs.promises, "readFile" as never, "fs.promises.readFile"),
  ];
  try {
    return { result: body(), attempts };
  } finally {
    for (const restore of restores) restore();
  }
}

describe("validation resolves nothing it is handed", () => {
  test("a document dense with addresses validates without a single request or read", () => {
    const serialized = JSON.stringify(addressed);
    const { result, attempts } = withSealedBoundaries(() =>
      parseSerializedStructuredExchange(serialized, checkStructuredExchangeSchema),
    );

    assert.deepEqual(attempts, [], `validation reached outside the document: ${attempts.join(", ")}`);
    assert.equal(result.valid, true, result.valid ? "" : JSON.stringify(result.issues));
  });

  test("an unknown profile is carried, not resolved, and never makes the document invalid", () => {
    const { result, attempts } = withSealedBoundaries(() =>
      parseSerializedStructuredExchange(
        JSON.stringify({ ...addressed, profile: "urn:nobody:has:heard:of:this" }),
        checkStructuredExchangeSchema,
      ),
    );
    assert.deepEqual(attempts, []);
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.envelope.profile, "urn:nobody:has:heard:of:this");
  });

  test("a profile that looks executable is text like any other", () => {
    // A profile is an identifier a reader may recognise. Nothing about the string
    // makes it a module, a URL to fetch, or an instruction to follow.
    for (const profile of [
      "file:///proc/self/environ",
      "node:child_process",
      "../../etc/passwd",
      "javascript:alert(1)",
    ]) {
      const { result, attempts } = withSealedBoundaries(() =>
        parseSerializedStructuredExchange(JSON.stringify({ ...addressed, profile }), checkStructuredExchangeSchema),
      );
      assert.deepEqual(attempts, [], `${profile} was resolved`);
      assert.equal(result.valid, true, `${profile} was refused rather than carried as text`);
      if (result.valid) assert.equal(result.envelope.profile, profile);
    }
  });

  test("a digest is checked against bytes nobody fetched, which means not at all", () => {
    // The digest binds an approval to specific bytes. Validation cannot know
    // whether the bytes match — it has not seen them, and must not go looking.
    const wrong = structuredClone(addressed);
    wrong.artifacts[0].sha256 = digest("f");
    const { result, attempts } = withSealedBoundaries(() =>
      parseSerializedStructuredExchange(JSON.stringify(wrong), checkStructuredExchangeSchema),
    );
    assert.deepEqual(attempts, []);
    assert.equal(result.valid, true, "a link was judged by its content rather than its shape");
  });

  test("the profile ceiling is a bound on text, not a guarantee about what it names", () => {
    const profile = "p".repeat(STRUCTURED_EXCHANGE_CEILINGS_2.profile + 1);
    const { result, attempts } = withSealedBoundaries(() =>
      parseSerializedStructuredExchange(JSON.stringify({ ...addressed, profile }), checkStructuredExchangeSchema),
    );
    assert.deepEqual(attempts, []);
    assert.equal(result.valid, false, "a profile past its ceiling was accepted");
  });
});
