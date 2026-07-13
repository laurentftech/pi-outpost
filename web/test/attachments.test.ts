import assert from "node:assert/strict";
import test from "node:test";
import {
  addPathAttachment,
  composePrompt,
  imagePreviewToAttachment,
  mentionedPaths,
  removeAttachment,
  replacePreviewAttachment,
  textPreviewToAttachment,
  type Attachment,
} from "../src/attachments.ts";

test("references the displayed text file by path instead of inlining it", () => {
  assert.deepEqual(textPreviewToAttachment("src/App.tsx"), {
    name: "src/App.tsx",
    kind: "path",
    data: "src/App.tsx",
    mimeType: "text/plain",
    source: "preview",
    previewPath: "src/App.tsx",
  });
});

test("converts a raw preview image to a wire attachment", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([0, 1, 2]), { headers: { "Content-Type": "image/png" } });
  try {
    const attachment = await imagePreviewToAttachment("chart.png", "/files/raw?path=chart.png");
    assert.deepEqual(attachment, {
      name: "chart.png",
      kind: "image",
      data: "AAEC",
      mimeType: "image/png",
      source: "preview",
      previewPath: "chart.png",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a raw file response that is not an image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not an image", { headers: { "Content-Type": "text/plain" } });
  try {
    const result = await imagePreviewToAttachment("readme.md", "/files/raw?path=readme.md");
    assert.equal(typeof result, "string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replaces only the automatic attachment", () => {
  const manual: Attachment = { name: "notes.txt", kind: "text", data: "notes", mimeType: "text/plain", source: "manual" };
  const previous = textPreviewToAttachment("old.ts");
  const next = textPreviewToAttachment("new.ts");
  assert.deepEqual(replacePreviewAttachment([manual, previous], next), [manual, next]);
});

test("removing the preview attachment preserves manual attachments", () => {
  const manual: Attachment = { name: "notes.txt", kind: "text", data: "notes", mimeType: "text/plain", source: "manual" };
  const preview = textPreviewToAttachment("new.ts");
  assert.deepEqual(removeAttachment([manual, preview], 1), [manual]);
});

test("attaches a tree file as a manual path reference", () => {
  assert.deepEqual(addPathAttachment([], "server/src/index.ts"), [
    { name: "server/src/index.ts", kind: "path", data: "server/src/index.ts", mimeType: "text/plain", source: "manual" },
  ]);
});

test("a path already referenced is not attached twice", () => {
  const fromTree = addPathAttachment([], "src/App.tsx");
  assert.equal(addPathAttachment(fromTree, "src/App.tsx"), fromTree);
  const fromPreview = [textPreviewToAttachment("src/App.tsx")];
  assert.equal(addPathAttachment(fromPreview, "src/App.tsx"), fromPreview);
});

test("sends referenced paths as @ mentions, not as content", () => {
  assert.equal(composePrompt("explain this", [textPreviewToAttachment("src/App.tsx")]), "explain this\n\n@src/App.tsx");
});

test("does not repeat a path the user already mentioned", () => {
  assert.equal(composePrompt("explain @src/App.tsx please", [textPreviewToAttachment("src/App.tsx")]), "explain @src/App.tsx please");
});

test("mentions a path once when two attachments reference it", () => {
  const attachments: Attachment[] = [textPreviewToAttachment("src/App.tsx"), { name: "src/App.tsx", kind: "path", data: "src/App.tsx", mimeType: "text/plain", source: "manual" }];
  assert.equal(composePrompt("look", attachments), "look\n\n@src/App.tsx");
});

test("a mention that only prefixes the attached path does not suppress it", () => {
  assert.equal(composePrompt("see @src/App.tsx.bak", [textPreviewToAttachment("src/App.tsx")]), "see @src/App.tsx.bak\n\n@src/App.tsx");
});

test("a mention followed by sentence punctuation still counts as mentioned", () => {
  for (const typed of ["explain @src/App.tsx.", "explain @src/App.tsx, please", "explain @src/App.tsx?"]) {
    assert.equal(composePrompt(typed, [textPreviewToAttachment("src/App.tsx")]), typed);
  }
});

test("reads the paths the draft references with @", () => {
  assert.deepEqual(mentionedPaths("compare @src/App.tsx with @server/src/index.ts, please"), ["src/App.tsx", "server/src/index.ts"]);
  assert.deepEqual(mentionedPaths("look at @src/App.tsx."), ["src/App.tsx"]);
  assert.deepEqual(mentionedPaths("no mention here"), []);
  assert.deepEqual(mentionedPaths("mail@example.com is not a path"), []);
});

test("dropped text files still travel inline as fenced blocks", () => {
  const dropped: Attachment = { name: "notes.txt", kind: "text", data: "hello", mimeType: "text/plain", source: "manual" };
  assert.equal(composePrompt("read", [dropped]), "read\n\n```notes.txt\nhello\n```");
});
