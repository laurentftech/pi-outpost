import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { packageFaults, visibleText } from "./testSupport";

/**
 * The validator, validated.
 *
 * Every "this package is sound" assertion elsewhere rests on `packageFaults`
 * returning an empty list. A checker that cannot fail would make all of them pass
 * for free — and the defect it exists to catch (Word reporting a document as
 * damaged) is exactly the kind that a vacuous check hides. So it is shown here
 * catching each fault it claims to look for.
 */

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  "</Types>",
].join("");

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://purl.org/officeDocument" Target="word/document.xml"/>',
  "</Relationships>",
].join("");

async function zipToBlob(build: (zip: JSZip) => void): Promise<Blob> {
  const zip = new JSZip();
  build(zip);
  return zip.generateAsync({ type: "blob" });
}

describe("packageFaults", () => {
  it("passes a package whose parts and relationships are all present", async () => {
    const blob = await zipToBlob((zip) => {
      zip.file("[Content_Types].xml", CONTENT_TYPES);
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("word/document.xml", "<document/>");
    });

    expect(await packageFaults(blob)).toEqual([]);
  });

  it("catches a relationship pointing at a part that is not there", async () => {
    // The defect that makes Word offer to repair a document.
    const blob = await zipToBlob((zip) => {
      zip.file("[Content_Types].xml", CONTENT_TYPES);
      zip.file("_rels/.rels", ROOT_RELS);
      // word/document.xml deliberately absent
    });

    const faults = await packageFaults(blob);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("word/document.xml");
  });

  it("catches a part with no declared content type", async () => {
    const blob = await zipToBlob((zip) => {
      // Only `.rels` is declared, so the `.xml` parts are undeclared.
      zip.file(
        "[Content_Types].xml",
        '<Types><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
      );
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("word/document.xml", "<document/>");
    });

    const faults = await packageFaults(blob);
    expect(faults.some((fault) => fault.includes("word/document.xml has no declared content type"))).toBe(true);
  });

  it("resolves a relationship relative to the folder holding its _rels", async () => {
    // `word/_rels/document.xml.rels` naming `media/x.png` means `word/media/x.png`.
    // Getting this wrong would report sound packages as broken.
    const blob = await zipToBlob((zip) => {
      zip.file("[Content_Types].xml", `${CONTENT_TYPES.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>')}`);
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("word/document.xml", "<document/>");
      zip.file(
        "word/_rels/document.xml.rels",
        '<Relationships><Relationship Id="rId9" Type="http://purl.org/image" Target="media/x.png"/></Relationships>',
      );
      zip.file("word/media/x.png", "not really a png");
    });

    expect(await packageFaults(blob)).toEqual([]);
  });

  it("does not treat an external hyperlink as a missing part", async () => {
    const blob = await zipToBlob((zip) => {
      zip.file("[Content_Types].xml", CONTENT_TYPES);
      zip.file("_rels/.rels", ROOT_RELS);
      zip.file("word/document.xml", "<document/>");
      zip.file(
        "word/_rels/document.xml.rels",
        '<Relationships><Relationship Id="rId9" Type="http://purl.org/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>',
      );
    });

    expect(await packageFaults(blob)).toEqual([]);
  });
});

describe("visibleText", () => {
  it("reads the text a reader sees, decoding what the package escapes", () => {
    // `>` is stored as `&gt;`, correctly; a test asking what the reader sees should
    // not have to know that, or it would assert on the storage instead.
    expect(visibleText("<w:t>A--&gt;B</w:t>")).toBe("A-->B");
    expect(visibleText('<w:t xml:space="preserve">  a &amp; b</w:t>')).toBe("  a & b");
  });

  it("does not mistake markup for text", () => {
    expect(visibleText("<w:p><w:pPr><w:b/></w:pPr><w:t>only this</w:t></w:p>")).toBe("only this");
  });
});
