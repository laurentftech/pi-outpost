import { describe, expect, it } from "vitest";
import { DrawioSpliceError, spliceDrawioPage } from "./drawioSplice";

const model = (cells: string, attributes = 'grid="1" pageWidth="1169"') =>
  `<mxGraphModel ${attributes}>\n  <root>\n    <mxCell id="0"/>\n    <mxCell id="1" parent="0"/>\n${cells}\n  </root>\n</mxGraphModel>`;

// A compressed page, as draw.io writes it by default: kept byte for byte
const COMPRESSED = "7VdNb9swDP01PmawLdtJj7GTdIeuwIAevF0Ei5W1yJIhy0nTXz/KofwRN1gx";

const file = [
  '<mxfile host="test">',
  '  <diagram id="p1" name="One">',
  `    ${model('    <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>').split("\n").join("\n    ")}`,
  "  </diagram>",
  "  <!-- the reader's own note -->",
  `  <diagram id="p2" name="Two">${COMPRESSED}</diagram>`,
  "</mxfile>",
].join("\n");

describe("spliceDrawioPage", () => {
  it("replaces only the page touched up, leaving the others byte for byte", () => {
    const touched = model('    <mxCell id="a" value="A moved" vertex="1" parent="1"><mxGeometry x="200" y="10" width="80" height="40" as="geometry"/></mxCell>');
    const out = spliceDrawioPage(file, 0, touched);
    expect(out).toContain('value="A moved"');
    expect(out).not.toContain('value="A" ');
    // Everything after the first page is exactly as it was
    const tail = file.slice(file.indexOf("  <!-- the reader's own note -->"));
    expect(out.endsWith(tail)).toBe(true);
    expect(out.startsWith('<mxfile host="test">\n  <diagram id="p1" name="One">\n')).toBe(true);
  });

  it("writes a compressed page out plain, and keeps the other pages", () => {
    const touched = model('    <mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>');
    const out = spliceDrawioPage(file, 1, touched);
    expect(out).not.toContain(COMPRESSED);
    expect(out).toContain('<diagram id="p2" name="Two">\n    <mxGraphModel grid="1" pageWidth="1169">');
    expect(out).toContain('value="B"');
    // The first page is untouched
    expect(out.slice(0, out.indexOf("  <!-- the reader's own note -->"))).toBe(file.slice(0, file.indexOf("  <!-- the reader's own note -->")));
  });

  it("keeps ids and the model's own attributes as the frame gives them", () => {
    const touched = model('    <mxCell id="keep-me" value="X" vertex="1" parent="1"/>', 'grid="0" pageWidth="1400" pageHeight="900"');
    const out = spliceDrawioPage(file, 0, touched);
    expect(out).toContain('id="keep-me"');
    expect(out).toContain('<mxGraphModel grid="0" pageWidth="1400" pageHeight="900">');
  });

  it("replaces a bare <mxGraphModel> file whole", () => {
    const bare = `<?xml version="1.0"?>\n${model("")}\n`;
    const out = spliceDrawioPage(bare, 0, model('    <mxCell id="n" vertex="1" parent="1"/>'));
    expect(out.startsWith('<?xml version="1.0"?>\n<mxGraphModel')).toBe(true);
    expect(out).toContain('id="n"');
    expect(out.endsWith("</mxGraphModel>\n")).toBe(true);
  });

  it("gives a self-closed page a body", () => {
    const out = spliceDrawioPage('<mxfile><diagram id="e" name="Empty"/></mxfile>', 0, model(""));
    expect(out).toMatch(/^<mxfile><diagram id="e" name="Empty">\n {2}<mxGraphModel[\s\S]*<\/mxGraphModel>\n<\/diagram><\/mxfile>$/);
  });

  it("keeps the file's CRLF line endings", () => {
    const crlf = file.split("\n").join("\r\n");
    const out = spliceDrawioPage(crlf, 0, model(""));
    expect(out.split("\n").every((line, i, all) => i === all.length - 1 || line.endsWith("\r"))).toBe(true);
  });

  it("refuses a page that does not exist, or a body that is not a model", () => {
    expect(() => spliceDrawioPage(file, 2, model(""))).toThrow(DrawioSpliceError);
    expect(() => spliceDrawioPage(file, 0, "<root/>")).toThrow(DrawioSpliceError);
    expect(() => spliceDrawioPage("<html/>", 0, model(""))).toThrow(DrawioSpliceError);
  });
});
