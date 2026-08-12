/**
 * Writing a custom provider to models.json.
 *
 * The file holds an API key despite its name suggesting plain configuration, and
 * it is one the user may have hand-written — so the two properties worth pinning
 * are that it ends up owner-readable only, and that a file we cannot parse is
 * never overwritten. The rest is the validation that stands between a client
 * frame and a provider id becoming a JSON key.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { CredentialError, providerConfig, providerFileEntry, storeProvider } from "../src/credentials.ts";
import type { ProviderDeclaration } from "../src/credentials.ts";

function declaration(overrides: Partial<ProviderDeclaration> = {}): ProviderDeclaration {
  return { provider: "corp", baseUrl: "https://llm.corp.example/v1", apiKey: "sk-corp", models: ["gpt-oss-120b"], ...overrides };
}

/** The reason a CredentialError carries, or a thrown assertion when it resolved. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CredentialError) return error.message;
    throw error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

describe("storeProvider", () => {
  let agentDir: string;
  let modelsPath: string;

  before(() => {
    agentDir = mkdtempSync(path.join(tmpdir(), "pi-creds-"));
    modelsPath = path.join(agentDir, "models.json");
  });
  beforeEach(() => {
    rmSync(modelsPath, { force: true });
  });
  after(() => rmSync(agentDir, { recursive: true, force: true }));

  const readFile = () => JSON.parse(readFileSync(modelsPath, "utf8"));

  describe("validation", () => {
    test("refuses a provider id that could not survive as a JSON key", async () => {
      for (const provider of ["", "../escape", "a/b", ".hidden", "a".repeat(65)]) {
        assert.match(await refusal(() => storeProvider(agentDir, declaration({ provider }))), /Invalid provider name/);
      }
    });

    test("refuses a base URL that is not http(s)", async () => {
      for (const baseUrl of ["file:///etc/passwd", "not a url", "ftp://example.com", ""]) {
        assert.match(await refusal(() => storeProvider(agentDir, declaration({ baseUrl }))), /must be an http\(s\) URL/);
      }
    });

    test("refuses a missing or blank API key", async () => {
      assert.match(await refusal(() => storeProvider(agentDir, declaration({ apiKey: "   " }))), /API key is required/);
      assert.match(
        await refusal(() => storeProvider(agentDir, declaration({ apiKey: undefined as unknown as string }))),
        /API key is required/,
      );
    });

    test("refuses a declaration with no usable model id", async () => {
      for (const models of [[], [""], ["  "], undefined as unknown as string[]]) {
        assert.match(await refusal(() => storeProvider(agentDir, declaration({ models }))), /At least one model id/);
      }
    });

    test("writes nothing when it refuses", async () => {
      await refusal(() => storeProvider(agentDir, declaration({ provider: "../escape" })));
      assert.throws(() => readFileSync(modelsPath, "utf8"), /ENOENT/);
    });
  });

  describe("writing", () => {
    test("creates the file with the declared provider", async () => {
      const written = await storeProvider(agentDir, declaration());
      assert.equal(written, modelsPath);
      const file = readFile();
      assert.equal(file.providers.corp.baseUrl, "https://llm.corp.example/v1");
      assert.equal(file.providers.corp.apiKey, "sk-corp");
      assert.deepEqual(file.providers.corp.models, [{ id: "gpt-oss-120b" }]);
    });

    test("creates the agent directory if it is not there yet", async () => {
      const fresh = path.join(agentDir, "nested", "deeper");
      await storeProvider(fresh, declaration());
      assert.ok(readFileSync(path.join(fresh, "models.json"), "utf8").includes("corp"));
      rmSync(path.join(agentDir, "nested"), { recursive: true, force: true });
    });

    test("keeps the file owner-readable only, since it holds a key", async (t) => {
      if (process.platform === "win32") return t.skip("POSIX permission bits are not meaningful here");
      await storeProvider(agentDir, declaration());
      assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
    });

    test("narrows a file the user left world-readable", async (t) => {
      if (process.platform === "win32") return t.skip("POSIX permission bits are not meaningful here");
      // writeFile's mode applies only on creation: a hand-written 0644 file would
      // keep those permissions and now hold an API key
      writeFileSync(modelsPath, JSON.stringify({ providers: {} }));
      chmodSync(modelsPath, 0o644);
      await storeProvider(agentDir, declaration());
      assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
    });

    test("merges into the existing providers rather than replacing them", async () => {
      writeFileSync(modelsPath, JSON.stringify({ providers: { other: { baseUrl: "https://other" } }, somethingElse: 1 }));
      await storeProvider(agentDir, declaration());
      const file = readFile();
      assert.ok(file.providers.other, "the user's other provider must survive");
      assert.ok(file.providers.corp);
      assert.equal(file.somethingElse, 1, "unrelated keys must survive too");
    });

    test("replaces a provider declared again under the same name", async () => {
      await storeProvider(agentDir, declaration());
      await storeProvider(agentDir, declaration({ baseUrl: "https://new.example/v1", apiKey: "sk-new" }));
      const file = readFile();
      assert.equal(file.providers.corp.baseUrl, "https://new.example/v1");
      assert.equal(file.providers.corp.apiKey, "sk-new");
    });

    test("refuses to clobber a file it cannot parse", async () => {
      writeFileSync(modelsPath, "{ not json at all");
      assert.match(await refusal(() => storeProvider(agentDir, declaration())), /not valid JSON — fix or move it first/);
      // The user's file is still there, untouched
      assert.equal(readFileSync(modelsPath, "utf8"), "{ not json at all");
    });

    test("refuses when the path is taken by a directory, without touching it", async () => {
      // The read fails with EISDIR rather than ENOENT, and only ENOENT is treated as
      // "no file yet" — so this lands on the do-not-clobber branch. The message names
      // JSON rather than the real cause, which is imprecise but errs the safe way:
      // it refuses and leaves the path alone.
      const blocked = path.join(agentDir, "blocked");
      mkdirSync(path.join(blocked, "models.json"), { recursive: true });
      try {
        assert.match(await refusal(() => storeProvider(blocked, declaration())), /fix or move it first/);
      } finally {
        rmSync(blocked, { recursive: true, force: true });
      }
    });
  });
});

describe("providerFileEntry", () => {
  test("trims the key and the model ids", () => {
    const entry = providerFileEntry(declaration({ apiKey: "  sk-corp  ", models: [" gpt-oss-120b "] }));
    assert.equal(entry.apiKey, "sk-corp");
    assert.deepEqual(entry.models, [{ id: "gpt-oss-120b" }]);
  });

  test("declares the OpenAI-completions API", () => {
    assert.equal(providerFileEntry(declaration()).api, "openai-completions");
  });

  test("carries compatibility flags when there are any", () => {
    const entry = providerFileEntry(declaration({ compat: { supportsDeveloperRole: false } }));
    assert.deepEqual(entry.compat, { supportsDeveloperRole: false });
  });

  test("omits an empty compat object rather than writing a useless key", () => {
    assert.ok(!("compat" in providerFileEntry(declaration({ compat: {} }))));
    assert.ok(!("compat" in providerFileEntry(declaration())));
  });

  test("keeps every declared model", () => {
    const entry = providerFileEntry(declaration({ models: ["a", "b", "c"] }));
    assert.deepEqual(entry.models, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  });
});

describe("providerConfig", () => {
  test("spells out the fields registerProvider needs but the file loader defaults", () => {
    const [model] = providerConfig(declaration()).models;
    assert.equal(model.id, "gpt-oss-120b");
    assert.equal(model.name, "gpt-oss-120b");
    assert.equal(model.reasoning, false);
    assert.deepEqual(model.input, ["text"]);
    assert.equal(model.contextWindow, 128000);
    assert.equal(model.maxTokens, 16384);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  test("agrees with the file entry on everything else", () => {
    const config = providerConfig(declaration({ compat: { supportsReasoningEffort: false } }));
    const entry = providerFileEntry(declaration({ compat: { supportsReasoningEffort: false } }));
    assert.equal(config.baseUrl, entry.baseUrl);
    assert.equal(config.apiKey, entry.apiKey);
    assert.equal(config.api, entry.api);
    assert.deepEqual(config.compat, entry.compat);
  });
});
