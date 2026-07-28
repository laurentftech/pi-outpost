import { describe, it, expect } from "vitest";
import {
  filesToAttachments,
  composePrompt,
  mentionedPaths,
  addPathAttachment,
  replacePreviewAttachment,
  removeAttachment,
  pathAttachment,
  textPreviewToAttachment,
  imagePreviewToAttachment,
  type Attachment,
} from "./attachments";

// ---------------------------------------------------------------------------
// filesToAttachments
// ---------------------------------------------------------------------------
describe("filesToAttachments", () => {
  it("converts image files to image attachments", async () => {
    const file = new File(["fake-png"], "screenshot.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024 });

    const { attachments, errors } = await filesToAttachments([file]);

    expect(errors).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: "screenshot.png",
      kind: "image",
      mimeType: "image/png",
      source: "manual",
    });
    // data should be base64
    expect(attachments[0].data).toBeTruthy();
  });

  it("converts text files to text attachments", async () => {
    const file = new File(["hello world"], "readme.txt", { type: "text/plain" });

    const { attachments, errors } = await filesToAttachments([file]);

    expect(errors).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: "readme.txt",
      kind: "text",
      data: "hello world",
      mimeType: "text/plain",
      source: "manual",
    });
  });

  it("rejects oversized images", async () => {
    const file = new File([], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 8 * 1024 * 1024 }); // > 7 MB

    const { attachments, errors } = await filesToAttachments([file]);

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("image too large");
  });

  it("rejects oversized text files", async () => {
    const file = new File([], "huge.txt", { type: "text/plain" });
    Object.defineProperty(file, "size", { value: 600 * 1024 }); // > 512 KB

    const { attachments, errors } = await filesToAttachments([file]);

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("file too large");
  });

  it("rejects binary text files (null byte)", async () => {
    const file = new File(["\0"], "binary.bin", { type: "application/octet-stream" });

    const { attachments, errors } = await filesToAttachments([file]);

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("unsupported binary file");
  });

  it("handles mixed files with partial errors", async () => {
    const ok = new File(["small"], "ok.txt", { type: "text/plain" });
    const oversized = new File([], "big.bin", { type: "application/octet-stream" });
    Object.defineProperty(oversized, "size", { value: 600 * 1024 });

    const { attachments, errors } = await filesToAttachments([ok, oversized]);

    expect(attachments).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("assigns text/plain default MIME for typeless text files", async () => {
    const file = new File(["data"], "foo", {});

    const { attachments } = await filesToAttachments([file]);

    expect(attachments[0].mimeType).toBe("text/plain");
  });
});

// ---------------------------------------------------------------------------
// composePrompt
// ---------------------------------------------------------------------------
describe("composePrompt", () => {
  it("returns plain text when there are no attachments", () => {
    expect(composePrompt("hello", [])).toBe("hello");
  });

  it("appends path references as @mentions", () => {
    const result = composePrompt("check this", [
      pathAttachment("src/index.ts"),
    ]);
    expect(result).toBe("check this\n\n@src/index.ts");
  });

  it("does not duplicate an @mention already in the text", () => {
    const result = composePrompt("see @src/index.ts", [
      pathAttachment("src/index.ts"),
    ]);
    expect(result).toBe("see @src/index.ts");
  });

  it("wraps text attachments in fenced blocks", () => {
    const result = composePrompt("here it is", [
      { name: "data.csv", kind: "text", data: "a,b,c", mimeType: "text/csv", source: "manual" },
    ]);
    expect(result).toContain("```data.csv");
    expect(result).toContain("a,b,c");
    expect(result).toContain("```");
  });

  it("combines path and text attachments", () => {
    const result = composePrompt("files", [
      pathAttachment("readme.md"),
      { name: "log.txt", kind: "text", data: "error", mimeType: "text/plain", source: "manual" },
    ]);
    expect(result).toContain("@readme.md");
    expect(result).toContain("```log.txt");
  });

  it("trims leading/trailing whitespace from the original text", () => {
    expect(composePrompt("  hi  ", [])).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// mentionedPaths
// ---------------------------------------------------------------------------
describe("mentionedPaths", () => {
  it("extracts @-prefixed paths", () => {
    expect(mentionedPaths("check @src/index.ts")).toEqual(["src/index.ts"]);
  });

  it("strips trailing sentence punctuation", () => {
    expect(mentionedPaths("see @src/index.ts.")).toEqual(["src/index.ts"]);
  });

  it("handles punctuation before sentence end", () => {
    expect(mentionedPaths("edit @src/App.tsx, please")).toEqual(["src/App.tsx"]);
    expect(mentionedPaths("check @src/App.tsx: is this right?")).toEqual(["src/App.tsx"]);
  });

  it("returns empty for text without @", () => {
    expect(mentionedPaths("hello world")).toEqual([]);
  });

  it("handles multiple @mentions", () => {
    const paths = mentionedPaths("fix @a.ts and @b.ts");
    expect(paths).toEqual(["a.ts", "b.ts"]);
  });

  it("ignores lone @ without a path", () => {
    expect(mentionedPaths("just @")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addPathAttachment
// ---------------------------------------------------------------------------
describe("addPathAttachment", () => {
  it("adds a new path attachment", () => {
    const result = addPathAttachment([], "src/index.ts");
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe("src/index.ts");
  });

  it("does not duplicate an existing path", () => {
    const existing = [pathAttachment("src/index.ts")];
    const result = addPathAttachment(existing, "src/index.ts");
    expect(result).toHaveLength(1);
  });

  it("adds a different path even when one already exists", () => {
    const existing = [pathAttachment("a.ts")];
    const result = addPathAttachment(existing, "b.ts");
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// replacePreviewAttachment
// ---------------------------------------------------------------------------
describe("replacePreviewAttachment", () => {
  it("replaces the preview attachment while keeping manual ones", () => {
    const manual = pathAttachment("src/index.ts");
    const existing: Attachment[] = [
      { ...pathAttachment("preview.ts"), source: "preview", previewPath: "preview.ts" },
      manual,
    ];
    const newPreview: Attachment = {
      ...pathAttachment("new.ts"),
      source: "preview",
      previewPath: "new.ts",
    };

    const result = replacePreviewAttachment(existing, newPreview);

    expect(result).toHaveLength(2);
    expect(result.find((a) => a.source === "preview")?.data).toBe("new.ts");
    expect(result.find((a) => a.source === "manual")?.data).toBe("src/index.ts");
  });

  it("handles empty attachments", () => {
    const result = replacePreviewAttachment([], pathAttachment("a.ts"));
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeAttachment
// ---------------------------------------------------------------------------
describe("removeAttachment", () => {
  it("removes the attachment at the given index", () => {
    const list: Attachment[] = [pathAttachment("a.ts"), pathAttachment("b.ts")];
    const result = removeAttachment(list, 0);
    expect(result).toHaveLength(1);
    expect(result[0].data).toBe("b.ts");
  });

  it("does not mutate the original array", () => {
    const list: Attachment[] = [pathAttachment("a.ts")];
    const result = removeAttachment(list, 0);
    expect(list).toHaveLength(1);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pathAttachment / textPreviewToAttachment
// ---------------------------------------------------------------------------
describe("pathAttachment / textPreviewToAttachment", () => {
  it("creates a manual path attachment", () => {
    const a = pathAttachment("src/foo.ts");
    expect(a).toEqual({
      name: "src/foo.ts",
      kind: "path",
      data: "src/foo.ts",
      mimeType: "text/plain",
      source: "manual",
    });
  });

  it("textPreviewToAttachment marks the attachment as preview", () => {
    const a = textPreviewToAttachment("src/foo.ts");
    expect(a.source).toBe("preview");
    expect(a.previewPath).toBe("src/foo.ts");
  });
});

// ---------------------------------------------------------------------------
// imagePreviewToAttachment
// ---------------------------------------------------------------------------
describe("imagePreviewToAttachment", () => {
  it("returns an error string when fetch fails", async () => {
    // jsdom fetch never rejects; we need to make it fail explicitly
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("fetch failed"));
    try {
      const result = await imagePreviewToAttachment("img.png", "http://invalid.local/image");
      expect(typeof result).toBe("string");
      expect(result).toContain("unable to read preview image");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
