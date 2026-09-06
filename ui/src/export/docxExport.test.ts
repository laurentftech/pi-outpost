import { describe, expect, it } from "vitest";
import { buildDocx, docxFileName, isMarkdownPath } from "./docxExport";
import { openDocx, partText } from "./testSupport";

describe("docxFileName", () => {
  it("replaces the source's extension rather than appending to it", () => {
    expect(docxFileName("report.md")).toBe("report.docx");
    expect(docxFileName("notes.txt")).toBe("notes.docx");
  });

  it("takes the name from the path, whichever separator the path uses", () => {
    expect(docxFileName("docs/guide/report.md")).toBe("report.docx");
    expect(docxFileName("docs\\guide\\report.md")).toBe("report.docx");
  });

  it("gives a name with no extension one, instead of eating its last word", () => {
    expect(docxFileName("CHANGELOG")).toBe("CHANGELOG.docx");
  });

  it("keeps the dots that are part of the name", () => {
    // Only the final extension is an extension. `v1.2` is a version, not a suffix
    // to be thrown away, and the export must not hand back `release.notes.v1.docx`.
    expect(docxFileName("release.notes.v1.2.md")).toBe("release.notes.v1.2.docx");
  });

  it("treats a dotfile's leading dot as its name, not an extension", () => {
    // `.gitignore` is not an empty stem with a `gitignore` extension; exporting it
    // as `.docx` would hand over a file with no name at all.
    expect(docxFileName(".gitignore")).toBe(".gitignore.docx");
  });
});

describe("isMarkdownPath", () => {
  it("recognises markdown by extension, whatever its case", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("README.MARKDOWN")).toBe(true);
  });

  it("does not treat other text as markdown", () => {
    expect(isMarkdownPath("server.log")).toBe(false);
    expect(isMarkdownPath("notes.md.bak")).toBe(false);
  });
});

describe("buildDocx", () => {
  it("produces a package Word can open — the parts every document must carry", async () => {
    const zip = await openDocx(await buildDocx("", "empty.md"));

    // The two parts without which the file is not a word-processing document at
    // all: the content-type map every OOXML package is opened through, and the
    // document part it points at.
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("word/document.xml")).not.toBeNull();

    const types = await partText(zip, "[Content_Types].xml");
    expect(types).toContain("wordprocessingml.document.main+xml");
  });

  it("declares the document part in the package relationships", async () => {
    // A package whose root relationships do not name the document opens as nothing:
    // the part can be present and still unreachable.
    const zip = await openDocx(await buildDocx("", "empty.md"));

    const rels = await partText(zip, "_rels/.rels");
    expect(rels).toContain("word/document.xml");
  });
});
