import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeName, hasBeenNamed, firstExchange, toSummary, snippetAround, searchSessions } from "../src/sessions.ts";
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
// SessionSummary is from shared — just duck-type for tests

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------
describe("sanitizeName", () => {
  test("passes through a clean short string", () => {
    assert.equal(sanitizeName("Hello World"), "Hello World");
  });

  test("takes the first non-empty line", () => {
    assert.equal(sanitizeName("\n\nActual Title\n\n"), "Actual Title");
  });

  test("trims whitespace", () => {
    assert.equal(sanitizeName("  padded  "), "padded");
  });

  test("strips leading and trailing quotes", () => {
    assert.equal(sanitizeName('"quoted"'), "quoted");
    assert.equal(sanitizeName("'single quoted'"), "single quoted");
    assert.equal(sanitizeName("`backtick`"), "backtick");
    assert.equal(sanitizeName('"""triple"""'), "triple");
  });

  test("replaces control characters with spaces", () => {
    // sanitizeName splits on \n first and takes the first line, so \t is the
    // relevant control character to test on a single line
    assert.equal(sanitizeName("hello\tworld"), "hello world");
  });

  test("returns empty string for all-empty input", () => {
    assert.equal(sanitizeName(""), "");
    assert.equal(sanitizeName("   "), "");
    assert.equal(sanitizeName("\n\n\n"), "");
  });

  test("truncates to MAX_NAME_LENGTH Unicode-aware", () => {
    const long = "a".repeat(100);
    const result = sanitizeName(long);
    assert.equal(result.length, 80);
    assert.equal(result, "a".repeat(80));
  });

  test("handles multi-byte Unicode without breaking surrogates", () => {
    const emoji = "🔥".repeat(50);
    const result = sanitizeName(emoji);
    // Each emoji is 2 UTF-16 code units but 1 code point — sanitizeName slices
    // by code point ([...clean].slice(0, N)), so the result has 50 code points
    assert.equal([...result].length, 50);
    // The string is shorter than MAX_NAME_LENGTH in code points, so it passes through
    assert.equal(result, emoji);
  });

  test("removes leading/trailing quotes after trimming", () => {
    assert.equal(sanitizeName('  "nested"  '), "nested");
  });
});

// ---------------------------------------------------------------------------
// hasBeenNamed
// ---------------------------------------------------------------------------
describe("hasBeenNamed", () => {
  test("returns false for empty entries", () => {
    assert.equal(hasBeenNamed([]), false);
  });

  test("returns false when no session_info entry exists", () => {
    // Neither a name nor a message: a model change, one of the entries a real session holds.
    const entries = [{ type: "message" } as SessionEntry, { type: "model_change" } as SessionEntry];
    assert.equal(hasBeenNamed(entries), false);
  });

  test("returns true when a session_info entry exists", () => {
    const entries = [{ type: "session_info" } as SessionEntry, { type: "message" } as SessionEntry];
    assert.equal(hasBeenNamed(entries), true);
  });

  test("returns true for a session_info among many entries", () => {
    const entries = [
      { type: "message" } as SessionEntry,
      { type: "message" } as SessionEntry,
      { type: "session_info" } as SessionEntry,
    ];
    assert.equal(hasBeenNamed(entries), true);
  });
});

// ---------------------------------------------------------------------------
// firstExchange
// ---------------------------------------------------------------------------
describe("firstExchange", () => {
  const userMsg = (content: string) =>
    ({ type: "message", message: { role: "user", content } }) as unknown as SessionEntry;
  const assistantMsg = (content: string) =>
    ({ type: "message", message: { role: "assistant", content } }) as unknown as SessionEntry;
  const toolEntry = () => ({ type: "tool_call" }) as SessionEntry;

  test("returns undefined for empty entries", () => {
    assert.equal(firstExchange([]), undefined);
  });

  test("returns undefined when no user message exists", () => {
    assert.equal(firstExchange([assistantMsg("hi")]), undefined);
  });

  test("returns undefined when no reply follows the user message", () => {
    assert.equal(firstExchange([userMsg("hello")]), undefined);
  });

  test("returns the exchange between first user and assistant", () => {
    const result = firstExchange([userMsg("Hello"), assistantMsg("Hi there!")]);
    assert.ok(result?.includes("user: Hello"));
    assert.ok(result?.includes("assistant: Hi there!"));
  });

  test("skips tool calls between user and assistant", () => {
    const result = firstExchange([userMsg("Do something"), toolEntry(), assistantMsg("Done!")]);
    assert.ok(result?.includes("user: Do something"));
    assert.ok(result?.includes("assistant: Done!"));
  });

  test("stops at the first assistant reply", () => {
    const result = firstExchange([userMsg("First"), assistantMsg("Reply"), assistantMsg("Second reply")]);
    assert.ok(result?.includes("user: First"));
    assert.ok(result?.includes("assistant: Reply"));
    assert.ok(!result?.includes("Second reply"));
  });

  test("only first user-assistant pair", () => {
    const result = firstExchange([
      userMsg("First ask"),
      assistantMsg("First answer"),
      userMsg("Second ask"),
      assistantMsg("Second answer"),
    ]);
    assert.ok(result?.includes("First ask"));
    assert.ok(result?.includes("First answer"));
    assert.ok(!result?.includes("Second ask"));
  });
});

// ---------------------------------------------------------------------------
// toSummary
// ---------------------------------------------------------------------------
describe("toSummary", () => {
  const mockInfo = (overrides: Partial<SessionInfo> = {}): SessionInfo =>
    ({
      path: "/sessions/test.json",
      id: "test-id",
      name: "Test Session",
      firstMessage: "Hello, how are you?",
      modified: new Date("2025-06-01T12:00:00Z"),
      messageCount: 5,
      allMessagesText: "full transcript text",
      ...overrides,
    }) as SessionInfo;

  test("includes all fields when name and snippet are present", () => {
    const result = toSummary(mockInfo(), "excerpt of transcript");
    assert.equal(result.path, "/sessions/test.json");
    assert.equal(result.id, "test-id");
    assert.equal(result.name, "Test Session");
    assert.equal(result.firstMessage, "Hello, how are you?");
    assert.equal(result.modified, "2025-06-01T12:00:00.000Z");
    assert.equal(result.messageCount, 5);
    assert.equal(result.snippet, "excerpt of transcript");
  });

  test("omits name when info has no name", () => {
    const result = toSummary(mockInfo({ name: undefined }));
    assert.equal(result.name, undefined);
  });

  test("omits snippet when not provided", () => {
    const result = toSummary(mockInfo());
    assert.equal(result.snippet, undefined);
  });

  test("truncates firstMessage to FIRST_MESSAGE_LENGTH", () => {
    const long = "x".repeat(200);
    const result = toSummary(mockInfo({ firstMessage: long }));
    assert.equal(result.firstMessage.length, 120);
    assert.equal(result.firstMessage, "x".repeat(120));
  });
});

// ---------------------------------------------------------------------------
// snippetAround
// ---------------------------------------------------------------------------
describe("snippetAround", () => {
  test("returns undefined when query is not found", () => {
    assert.equal(snippetAround("hello world", "xyz"), undefined);
  });

  test("extracts a centered snippet around the match", () => {
    // snippetAround lowercases the text but expects the query to be lowercase
    const text = "a".repeat(50) + "MATCH" + "b".repeat(50);
    const result = snippetAround(text, "match");
    assert.ok(result?.includes("MATCH"));
    assert.ok(result!.length <= 122, `snippet too long: ${result!.length}`);
  });

  test("returns the middle excerpt trimmed", () => {
    const text = "before MATCH after";
    const result = snippetAround(text, "match");
    assert.ok(result?.includes("MATCH"));
    assert.ok(result?.startsWith("before") || result?.startsWith("…"), `unexpected start: ${result}`);
  });

  test("adds leading ellipsis when match is past the start", () => {
    const text = "a".repeat(200) + "MATCH" + "b".repeat(200);
    const result = snippetAround(text, "match");
    assert.ok(result?.startsWith("…"), `expected leading ellipsis: ${result}`);
    assert.ok(result?.includes("MATCH"));
    assert.ok(result?.endsWith("…"), `expected trailing ellipsis: ${result}`);
  });

  test("no leading ellipsis when match is near the start", () => {
    const text = "MATCH" + "b".repeat(200);
    const result = snippetAround(text, "MATCH");
    assert.ok(!result?.startsWith("…"), `unexpected leading ellipsis: ${result}`);
  });

  test("no trailing ellipsis when match is near the end", () => {
    const text = "a".repeat(200) + "MATCH";
    const result = snippetAround(text, "MATCH");
    assert.ok(!result?.endsWith("…"), `unexpected trailing ellipsis: ${result}`);
  });

  test("case-insensitive matching", () => {
    const result = snippetAround("Hello MATCH World", "match");
    assert.ok(result?.includes("MATCH"));
  });

  test("handles query longer than SNIPPET_LENGTH", () => {
    const query = "x".repeat(200);
    const text = query;
    const result = snippetAround(text, query);
    assert.ok(result?.includes(query));
  });

  test("collapses whitespace", () => {
    const result = snippetAround("hello    world  match  test", "match");
    assert.ok(result);
    assert.ok(!result?.includes("  "), `whitespace not collapsed: ${result}`);
  });
});

// ---------------------------------------------------------------------------
// searchSessions
// ---------------------------------------------------------------------------
describe("searchSessions", () => {
  const session = (overrides: Partial<SessionInfo> = {}): SessionInfo =>
    ({
      path: "/sessions/test.json",
      id: "test-id",
      name: "My Session",
      firstMessage: "Hello world",
      modified: new Date("2025-06-01T12:00:00Z"),
      messageCount: 3,
      allMessagesText: "This is a conversation about databases.",
      ...overrides,
    }) as SessionInfo;

  test("returns empty for query shorter than MIN_SESSION_QUERY_LENGTH", () => {
    const result = searchSessions([session()], "a", 10);
    assert.deepEqual(result, []);
  });

  test("matches session by name", () => {
    const result = searchSessions([session({ name: "Database Migration" })], "database", 10);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "test-id");
  });

  test("matches session by first message", () => {
    const result = searchSessions([session({ firstMessage: "How to migrate DB?" })], "migrate", 10);
    assert.equal(result.length, 1);
  });

  test("matches session by transcript content", () => {
    const result = searchSessions(
      [session({ allMessagesText: "We discussed PostgreSQL indexing strategies." })],
      "postgresql",
      10,
    );
    assert.equal(result.length, 1);
  });

  test("returns sessions sorted by modified descending", () => {
    const older = session({
      id: "old",
      modified: new Date("2025-01-01T00:00:00Z"),
      name: "Alpha",
      firstMessage: "old stuff",
      allMessagesText: "old",
    });
    const newer = session({
      id: "new",
      modified: new Date("2025-06-01T00:00:00Z"),
      name: "Beta",
      firstMessage: "new stuff",
      allMessagesText: "new",
    });
    const result = searchSessions([older, newer], "stuff", 10);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "new");
    assert.equal(result[1].id, "old");
  });

  test("limits results", () => {
    const s1 = session({ id: "1", name: "A", firstMessage: "topic", allMessagesText: "topic" });
    const s2 = session({ id: "2", name: "B", firstMessage: "topic", allMessagesText: "topic" });
    const s3 = session({ id: "3", name: "C", firstMessage: "topic", allMessagesText: "topic" });
    const result = searchSessions([s1, s2, s3], "topic", 2);
    assert.equal(result.length, 2);
  });

  test("matches are case-insensitive", () => {
    const result = searchSessions([session({ name: "DATABASE" })], "Database", 10);
    assert.equal(result.length, 1);
  });

  test("empty query returns empty", () => {
    const result = searchSessions([session()], "", 10);
    assert.deepEqual(result, []);
  });

  test("whitespace-only query returns empty", () => {
    const result = searchSessions([session()], "   ", 10);
    assert.deepEqual(result, []);
  });
});
