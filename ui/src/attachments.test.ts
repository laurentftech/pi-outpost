import { describe, it, expect, vi } from "vitest";
import { UploadError } from "./uploads";
import {
  classifyDroppedFile,
  needsUpload,
  filesToAttachments,
  composePrompt,
  mentionedPaths,
  addPathAttachment,
  replacePreviewAttachment,
  removeAttachment,
  pathAttachment,
  textPreviewToAttachment,
  pdfPreviewToAttachment,
  imagePreviewToAttachment,
  type Attachment,
} from "./attachments";

// ---------------------------------------------------------------------------
// classifyDroppedFile
// ---------------------------------------------------------------------------

/** A `File` of a stated size — the real bytes are irrelevant to the size branches. */
function sized(name: string, type: string, size: number, content = "x"): File {
  const file = new File([content], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Stands in for the server: echoes back a path under the uploads directory. */
function stubUpload(written?: (name: string) => string) {
  return vi.fn(async (name: string) => (written ? written(name) : `uploads/${name}`));
}

describe("classifyDroppedFile", () => {
  it("routes formats with a path-based extraction tool to an upload", () => {
    expect(classifyDroppedFile(sized("report.pdf", "application/pdf", 900_000))).toBe("extraction-tool");
    // The extension decides even when the browser supplies no type at all
    expect(classifyDroppedFile(sized("report.pdf", "", 900_000))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 40_000))).toBe(
      "extraction-tool",
    );
    expect(classifyDroppedFile(sized("budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 40_000))).toBe(
      "extraction-tool",
    );
    expect(classifyDroppedFile(sized("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 40_000))).toBe(
      "extraction-tool",
    );
  });

  it("routes images to the image branch whatever their size", () => {
    expect(classifyDroppedFile(sized("shot.png", "image/png", 1024))).toBe("image");
    expect(classifyDroppedFile(sized("huge.jpg", "image/jpeg", 20 * 1024 * 1024))).toBe("image");
  });

  it("inlines small text and refuses a binary with no tool behind it", () => {
    expect(classifyDroppedFile(sized("readme.txt", "text/plain", 400))).toBe("inline-text");
    expect(classifyDroppedFile(sized("archive.zip", "application/zip", 900_000))).toBe("unsupported");
    expect(classifyDroppedFile(sized("enormous.zip", "application/zip", 30 * 1024 * 1024))).toBe("unsupported");
  });

  it("routes an email to an upload whatever its size, so its MIME never reaches the prompt", () => {
    // A `.msg` is binary and would be refused as an unsupported binary file; a small
    // `.eml` is text and would be *inlined* — headers, boundaries, base64 and all.
    // Both are files a tool reads at a path, so both travel as a path.
    expect(classifyDroppedFile(sized("Bienvenue.msg", "application/vnd.ms-outlook", 180_000))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("Bienvenue.msg", "", 180_000))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("message.eml", "message/rfc822", 1_200))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("message.eml", "", 1_200))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("stored.emlx", "", 4_000))).toBe("extraction-tool");
    // Case does not matter: a message off a Windows share shouts.
    expect(classifyDroppedFile(sized("BIENVENUE.MSG", "", 9_000))).toBe("extraction-tool");
  });

  it("agrees with needsUpload, so the pending chip is shown for exactly these files", () => {
    for (const file of [
      sized("Bienvenue.msg", "application/vnd.ms-outlook", 180_000),
      sized("message.eml", "message/rfc822", 1_200),
      sized("stored.emlx", "", 4_000),
      sized("report.pdf", "application/pdf", 900_000),
    ]) {
      expect(needsUpload(file)).toBe(true);
    }
    // And not for the files that never reach the server.
    expect(needsUpload(sized("readme.txt", "text/plain", 400))).toBe(false);
    expect(needsUpload(sized("shot.png", "image/png", 1024))).toBe(false);
  });

  it("uploads text too big to inline, and refuses it only past the upload cap", () => {
    expect(classifyDroppedFile(sized("huge.txt", "text/plain", 600 * 1024))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("server.log", "text/plain", 5 * 1024 * 1024))).toBe("extraction-tool");
    expect(classifyDroppedFile(sized("giant.log", "text/plain", 30 * 1024 * 1024))).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// filesToAttachments
// ---------------------------------------------------------------------------
describe("filesToAttachments", () => {
  it("converts image files to image attachments", async () => {
    const file = sized("screenshot.png", "image/png", 1024, "fake-png");

    const { attachments, errors } = await filesToAttachments([file], stubUpload());

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
    const upload = stubUpload();

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: "readme.txt",
      kind: "text",
      data: "hello world",
      mimeType: "text/plain",
      source: "manual",
    });
    // Inline text keeps travelling in the prompt — nothing is copied into the workspace
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a dropped .eml and attaches the path, not its MIME source", async () => {
    const mime = [
      "From: =?UTF-8?Q?Fran=C3=A7ois?= <francois@example.test>",
      "Subject: Dossier",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Voir les pieces jointes.",
      "--b1",
      "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjcgYSByZXBvcnQ=",
      "--b1--",
      "",
    ].join("\r\n");
    // Well under the 512 KB inline limit: the branch this has to *not* take.
    const file = sized("Dossier.eml", "message/rfc822", mime.length, mime);
    const upload = stubUpload(() => "uploads/Dossier.eml");

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(upload).toHaveBeenCalledOnce();
    expect(attachments).toEqual([
      { name: "uploads/Dossier.eml", kind: "path", data: "uploads/Dossier.eml", mimeType: "text/plain", source: "manual" },
    ]);
    // The prompt carries the path and none of the message.
    const prompt = composePrompt("Que dit ce mail ?", attachments);
    expect(prompt).toBe("Que dit ce mail ?\n\n@uploads/Dossier.eml");
    expect(prompt).not.toContain("boundary");
    expect(prompt).not.toContain("JVBERi0x");
  });

  it("uploads a dropped .msg instead of refusing it as an unsupported binary", async () => {
    // A compound file starts with a signature full of NULs — the byte that used to
    // make this an "unsupported binary file".
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00]);
    const file = new File([bytes], "Bienvenue.msg", { type: "application/vnd.ms-outlook" });
    const upload = stubUpload(() => "uploads/Bienvenue.msg");

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(attachments).toEqual([
      { name: "uploads/Bienvenue.msg", kind: "path", data: "uploads/Bienvenue.msg", mimeType: "text/plain", source: "manual" },
    ]);
    expect(composePrompt("", attachments)).toBe("@uploads/Bienvenue.msg");
  });

  it("uploads a PDF and attaches the written path instead of its bytes", async () => {
    const file = sized("Salon ALL AMERICAN.pdf", "application/pdf", 900_000, "%PDF-1.7");
    const upload = stubUpload(() => "uploads/Salon ALL AMERICAN.pdf");

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(attachments).toEqual([
      { name: "uploads/Salon ALL AMERICAN.pdf", kind: "path", data: "uploads/Salon ALL AMERICAN.pdf", mimeType: "text/plain", source: "manual" },
    ]);
  });

  it("references the path the server wrote, not the name it was asked for", async () => {
    const file = sized("report.pdf", "application/pdf", 2048, "%PDF-1.7");
    const upload = stubUpload(() => "uploads/report-1.pdf");

    const { attachments } = await filesToAttachments([file], upload);

    expect(attachments[0].data).toBe("uploads/report-1.pdf");
  });

  it("attaches an image within the limit as bytes, with no copy in the workspace", async () => {
    const file = sized("shot.png", "image/png", 1024, "fake-png");
    const upload = stubUpload();

    const { attachments } = await filesToAttachments([file], upload);

    // The prompt already carries the file; a copy nothing references would just
    // dirty the working tree on every pasted screenshot.
    expect(upload).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("image");
    expect(attachments.some((attachment) => attachment.kind === "path")).toBe(false);
  });

  it("references an oversized image by path rather than refusing it", async () => {
    const file = sized("huge.png", "image/png", 8 * 1024 * 1024); // > 7 MB, under the upload cap
    const upload = stubUpload(() => "uploads/huge.png");

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ kind: "path", data: "uploads/huge.png" });
  });

  it("rejects a file past the upload cap without reading or sending it", async () => {
    const file = sized("enormous.pdf", "application/pdf", 26 * 1024 * 1024);
    const upload = stubUpload();

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("too large to upload");
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a read-only workspace as such, leaving no attachment behind", async () => {
    const file = sized("report.pdf", "application/pdf", 2048, "%PDF-1.7");
    const upload = vi.fn(async () => {
      throw new UploadError("the workspace is read-only", "denied");
    });

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(attachments).toEqual([]);
    expect(errors[0]).toContain("read-only");
    expect(errors[0]).not.toContain("512 KB");
  });

  it("attaches an image's bytes even in a workspace that cannot be written", async () => {
    // Pasting a screenshot worked before uploads existed, and a read-only sandbox
    // must not take that away — the attachment never needed a copy.
    const file = sized("shot.png", "image/png", 1024, "fake-png");
    const upload = vi.fn(async () => {
      throw new UploadError("the workspace is read-only", "denied");
    });

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ name: "shot.png", kind: "image", mimeType: "image/png" });
    expect(attachments[0].data).toBeTruthy();
  });

  it("fails an oversized image whose only route was the path", async () => {
    const file = sized("huge.png", "image/png", 8 * 1024 * 1024);
    const upload = vi.fn(async () => {
      throw new UploadError("the workspace is read-only", "denied");
    });

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(attachments).toEqual([]);
    expect(errors[0]).toContain("read-only");
  });

  it("keeps the batch alive when a file cannot be read at all", async () => {
    const unreadable = new File(["x"], "vanished.txt", { type: "text/plain" });
    Object.defineProperty(unreadable, "text", {
      value: () => Promise.reject(new DOMException("NotReadableError")),
    });
    const ok = new File(["still here"], "ok.txt", { type: "text/plain" });

    const { attachments, errors } = await filesToAttachments([unreadable, ok], stubUpload());

    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe("ok.txt");
    expect(errors[0]).toContain("vanished.txt");
  });

  it("reports a server-side upload failure without inventing a path", async () => {
    const file = sized("report.pdf", "application/pdf", 2048, "%PDF-1.7");
    const upload = vi.fn(async () => {
      // No reason: an unexpected server error carries none
      throw new UploadError("disk is full");
    });

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(attachments).toEqual([]);
    expect(errors[0]).toContain("upload failed");
    expect(errors[0]).toContain("disk is full");
  });

  it("passes a malformed-request refusal through in the server's own words", async () => {
    const file = sized("CON.pdf", "application/pdf", 2048, "%PDF-1.7");
    const upload = vi.fn(async () => {
      throw new UploadError('"CON.pdf" is a reserved device name', "invalid");
    });

    const { errors } = await filesToAttachments([file], upload);

    expect(errors[0]).toBe('CON.pdf: "CON.pdf" is a reserved device name');
    expect(errors[0]).not.toContain("upload failed");
  });

  it("reports the server's own size refusal", async () => {
    const file = sized("report.pdf", "application/pdf", 2048, "%PDF-1.7");
    const upload = vi.fn(async () => {
      throw new UploadError("Uploads are limited to 25 MB", "too-large");
    });

    const { errors } = await filesToAttachments([file], upload);

    expect(errors[0]).toContain("too large to upload");
  });

  it("references text too large to inline instead of refusing it", async () => {
    const file = sized("server.log", "text/plain", 600 * 1024); // > 512 KB, well under the upload cap
    const upload = stubUpload(() => "uploads/server.log");

    const { attachments, errors } = await filesToAttachments([file], upload);

    expect(errors).toEqual([]);
    expect(attachments).toEqual([
      { name: "uploads/server.log", kind: "path", data: "uploads/server.log", mimeType: "text/plain", source: "manual" },
    ]);
  });

  it("refuses text past the upload cap against that cap, not the inline limit", async () => {
    const file = sized("giant.log", "text/plain", 30 * 1024 * 1024);

    const { attachments, errors } = await filesToAttachments([file], stubUpload());

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("too large to upload");
    expect(errors[0]).not.toContain("512 KB");
  });

  it("names an unsupported binary's own type instead of the text limit", async () => {
    const file = sized("archive.zip", "application/zip", 900 * 1024);

    const { attachments, errors } = await filesToAttachments([file], stubUpload());

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("unsupported file type");
    expect(errors[0]).toContain("application/zip");
    expect(errors[0]).not.toContain("512 KB");
  });

  it("rejects binary text files (null byte)", async () => {
    const file = new File(["\0"], "binary.bin", { type: "application/octet-stream" });

    const { attachments, errors } = await filesToAttachments([file], stubUpload());

    expect(attachments).toHaveLength(0);
    expect(errors[0]).toContain("unsupported binary file");
  });

  it("settles every file in a mixed drop: one refusal keeps the rest", async () => {
    const ok = new File(["small"], "ok.txt", { type: "text/plain" });
    const pdf = sized("report.pdf", "application/pdf", 2048, "%PDF-1.7");
    const refused = sized("archive.zip", "application/zip", 900 * 1024);
    const upload = stubUpload();

    const { attachments, errors } = await filesToAttachments([ok, pdf, refused], upload);

    expect(attachments.map((attachment) => attachment.kind)).toEqual(["text", "path"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("archive.zip");
  });

  it("runs the uploads of a multi-file drop concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const upload = vi.fn(async (name: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return `uploads/${name}`;
    });
    const files = ["a.pdf", "b.pdf", "c.pdf"].map((name) => sized(name, "application/pdf", 2048, "%PDF-1.7"));

    const { attachments } = await filesToAttachments(files, upload);

    expect(attachments).toHaveLength(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("assigns text/plain default MIME for typeless text files", async () => {
    const file = new File(["data"], "foo", {});

    const { attachments } = await filesToAttachments([file], stubUpload());

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

  it("mentions a path once when two attachments reference it", () => {
    const result = composePrompt("look", [
      textPreviewToAttachment("src/index.ts"),
      pathAttachment("src/index.ts"),
    ]);
    expect(result).toBe("look\n\n@src/index.ts");
  });

  it("a mention that only prefixes the attached path does not suppress it", () => {
    const result = composePrompt("see @src/index.ts.bak", [
      pathAttachment("src/index.ts"),
    ]);
    expect(result).toBe("see @src/index.ts.bak\n\n@src/index.ts");
  });

  it("a mention followed by sentence punctuation still counts as mentioned", () => {
    for (const typed of ["explain @src/index.ts.", "explain @src/index.ts, please", "explain @src/index.ts?"]) {
      expect(composePrompt(typed, [pathAttachment("src/index.ts")])).toBe(typed);
    }
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

  it("strips a long run of trailing punctuation without stalling", () => {
    // The regex this replaced was O(n^2) on exactly this shape (CodeQL #9): 100k
    // repetitions took seconds. Linear stripping returns immediately, so the test's
    // own timeout is the assertion that it stayed linear.
    expect(mentionedPaths(`see @a.ts${"!".repeat(100_000)}`)).toEqual(["a.ts"]);
  });

  it("does not read an email address as a path", () => {
    expect(mentionedPaths("mail@example.com is not a path")).toEqual([]);
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

  it("pdfPreviewToAttachment references the path and never carries the bytes", () => {
    const a = pdfPreviewToAttachment("docs/report.pdf");
    expect(a).toEqual({
      name: "docs/report.pdf",
      kind: "path",
      data: "docs/report.pdf",
      mimeType: "text/plain",
      source: "preview",
      previewPath: "docs/report.pdf",
    });
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
