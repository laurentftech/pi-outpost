import { describe, it, expect, vi, afterEach } from "vitest";
import type { StructuredTableData } from "@pi-outpost/shared/structured-exchange";
import { filterKey } from "./structuredExchange";
import { downloadCsv, downloadMarkdown, tableExport, tableMarkdown, toCsv } from "./tableExport";

const roled: StructuredTableData = {
  columns: ["ID", "Requirement", "Weight"],
  rows: [
    { role: "added", cells: ["REQ-5", 'Log "every" actuation, always.', 12] },
    { role: "removed", cells: ["REQ-3", "Read battery voltage at 10 Hz.", 3] },
    { cells: ["REQ-1", "Stop within 40 m.", null] },
  ],
};

const plain: StructuredTableData = {
  columns: ["ID", "Status"],
  rows: [
    ["REQ-1", "approved"],
    ["REQ-2", "draft"],
  ],
};

/** A specification: chapters, and the requirements that sit under them. */
const chaptered: StructuredTableData = {
  columns: ["ID", "Requirement"],
  rows: [
    { heading: "1. Braking", depth: 1 },
    { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m."] },
    { heading: "1.1 Sensing", depth: 2 },
    { id: "r2", ref: "REQ-2", kind: "requirement", cells: ["REQ-2", "Read wheel speed."] },
  ] as unknown as StructuredTableData["rows"],
};

const nothingHidden: ReadonlySet<string> = new Set();

describe("what an export carries", () => {
  it("adds a column for the role, since the colour cannot cross", () => {
    const exported = tableExport(roled, nothingHidden);
    expect(exported.columns).toEqual(["ID", "Requirement", "Weight", "change"]);
    expect(exported.rows.map((row) => row.at(-1))).toEqual(["added", "removed", "existing"]);
  });

  it("invents no column for a table that declares no role", () => {
    expect(tableExport(plain, nothingHidden).columns).toEqual(["ID", "Status"]);
    expect(tableExport(plain, nothingHidden).rows).toEqual([
      ["REQ-1", "approved"],
      ["REQ-2", "draft"],
    ]);
  });

  it("carries what is shown, and counts what it left behind", () => {
    const exported = tableExport(roled, new Set([filterKey("role", "removed")]));
    expect(exported.rows.map((row) => row[0])).toEqual(["REQ-5", "REQ-1"]);
    expect(exported.withheld).toBe(1);
  });
});

describe("a specification keeps its chapters", () => {
  it("gives a chaptered table columns for the section and its level", () => {
    // Without them a heading has no cells to occupy and leaves as a blank line:
    // the export would hand back a flat list of requirements with the structure
    // of the document silently gone.
    const exported = tableExport(chaptered, nothingHidden);
    expect(exported.columns).toEqual(["section", "level", "ID", "Requirement"]);
  });

  it("keeps each heading in its place among the rows it introduces", () => {
    const exported = tableExport(chaptered, nothingHidden);
    expect(exported.rows).toEqual([
      ["1. Braking", 1, null, null],
      [null, null, "REQ-1", "Stop within 40 m."],
      ["1.1 Sensing", 2, null, null],
      [null, null, "REQ-2", "Read wheel speed."],
    ]);
  });

  it("does not write a section onto the rows that follow it", () => {
    // A row follows a heading; it never declares that it belongs to one. Filling
    // the column down would state a membership the document does not.
    const exported = tableExport(chaptered, nothingHidden);
    expect(exported.rows[1][0]).toBeNull();
    expect(exported.rows[3][0]).toBeNull();
  });

  it("invents no section column for a table that has no chapters", () => {
    expect(tableExport(plain, nothingHidden).columns).toEqual(["ID", "Status"]);
  });

  it("carries chapters and roles together, each in its own column", () => {
    const both: StructuredTableData = {
      columns: ["ID"],
      rows: [
        { heading: "1. Braking", depth: 1 },
        { role: "added", cells: ["REQ-5"] },
      ] as unknown as StructuredTableData["rows"],
    };
    const exported = tableExport(both, nothingHidden);
    expect(exported.columns).toEqual(["section", "level", "ID", "change"]);
    expect(exported.rows).toEqual([
      ["1. Braking", 1, null, "existing"],
      [null, null, "REQ-5", "added"],
    ]);
  });
});

describe("comma-separated values", () => {
  it("quotes a value that would otherwise break the file apart", () => {
    const csv = toCsv(tableExport(roled, nothingHidden));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("ID,Requirement,Weight,change");
    // A comma and a quote in one prose cell: written raw this is three fields
    expect(lines[1]).toBe('REQ-5,"Log ""every"" actuation, always.",12,added');
  });

  it("writes an empty field for a null, not the word", () => {
    const csv = toCsv(tableExport(roled, nothingHidden));
    expect(csv.split("\r\n").at(-1)).toBe("REQ-1,Stop within 40 m.,,existing");
  });

  it("keeps a newline inside a cell inside its own field", () => {
    const wrapped: StructuredTableData = { columns: ["note"], rows: [["one\ntwo"]] };
    expect(toCsv(tableExport(wrapped, nothingHidden))).toBe('note\r\n"one\ntwo"');
  });
});

/**
 * Handing the browser a file.
 *
 * The pure half above decides what an export contains; this half is what actually
 * reaches the reader's disk, and it was the untested half. Two things live here
 * that nothing else checks: the byte-order mark that is the difference between a
 * French requirement arriving intact and arriving mangled in Excel, and the cell
 * typing that is the difference between a spreadsheet and a picture of one.
 */
describe("handing the browser a file", () => {
  /** The anchor `save` builds, and the blob it was given. */
  function captureDownload() {
    const anchors: HTMLAnchorElement[] = [];
    const blobs: Blob[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, ...rest: unknown[]) => {
      const element = realCreate(tag, ...(rest as []));
      if (tag === "a") {
        // The click navigates in a real browser and is "not implemented" in jsdom;
        // what matters is that it happened, on an anchor carrying this name.
        (element as HTMLAnchorElement).click = () => anchors.push(element as HTMLAnchorElement);
      }
      return element;
    });
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:table";
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    return { anchors, blobs, revoked };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("saves the CSV under the name it was given, and lets the url go", async () => {
    const { anchors, blobs, revoked } = captureDownload();

    downloadCsv(tableExport(roled, nothingHidden), "requirements.csv");

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("requirements.csv");
    expect(anchors[0].href).toBe("blob:table");
    // Not leaked: a blob url held for the life of the page holds the file with it.
    expect(revoked).toEqual(["blob:table"]);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
  });

  it("saves the Markdown of the rows shown, under the name it was given", async () => {
    const { anchors, blobs, revoked } = captureDownload();

    downloadMarkdown(chaptered, nothingHidden, undefined, "specification.md");

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("specification.md");
    expect(revoked).toEqual(["blob:table"]);
    expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
    // The same text the reference validator writes: one function, wherever it runs.
    expect(await blobs[0].text()).toBe(tableMarkdown(chaptered, nothingHidden));
    expect(await blobs[0].text()).toContain("## 1. Braking");
  });

  it("writes the byte-order mark Excel needs, ahead of the rows", async () => {
    // Without it Excel reads a UTF-8 file as the local code page, and a requirement
    // written in French arrives mangled. It has to be first, not merely present.
    const { blobs } = captureDownload();
    const accented: StructuredTableData = { columns: ["exigence"], rows: [["Arrêt en 40 m"]] };

    downloadCsv(tableExport(accented, nothingHidden), "fr.csv");

    // Read as bytes, not as text: `Blob.text()` decodes UTF-8 and strips a leading
    // BOM by specification, so a text assertion here passes whether or not the mark
    // was ever written — which is the one thing this test exists to check.
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await blobs[0].text()).toContain("Arrêt en 40 m");
  });

  it("types a workbook's cells as what they are, so a number sorts as a number", async () => {
    // Asserted on what the writer is handed rather than on the bytes it produces:
    // the typing is this module's decision, and the workbook format is not.
    const handed: unknown[][] = [];
    vi.doMock("write-excel-file/browser", () => ({
      default: (rows: unknown[][]) => {
        handed.push(...rows);
        return { toBlob: async () => new Blob(["xlsx"]) };
      },
    }));
    const { anchors } = captureDownload();
    const mixed: StructuredTableData = {
      columns: ["ID", "Weight", "Signed", "Note"],
      rows: [["REQ-1", 12, true, null]],
    };

    const { downloadXlsx: freshDownloadXlsx } = await import("./tableExport");
    await freshDownloadXlsx(tableExport(mixed, nothingHidden), "requirements.xlsx");

    const [header, row] = handed as [{ value: string; fontWeight?: string }[], { value: unknown; type?: unknown }[]];
    expect(header.map((cell) => cell.value)).toEqual(["ID", "Weight", "Signed", "Note"]);
    expect(header.every((cell) => cell.fontWeight === "bold")).toBe(true);
    expect(row[0]).toEqual({ value: "REQ-1", type: String });
    expect(row[1]).toEqual({ value: 12, type: Number });
    expect(row[2]).toEqual({ value: true, type: Boolean });
    // A null is an empty cell, not the word "null" — which a spreadsheet would
    // otherwise sort and filter on as if somebody had written it.
    expect(row[3]).toEqual({ value: undefined });
    expect(anchors[0].download).toBe("requirements.xlsx");
    vi.doUnmock("write-excel-file/browser");
  });
});

describe("a proposal's derived roles leave with it", () => {
  // A proposed table declares no role on any row — declaring one beside a change is
  // refused — so asking the data alone dropped the role column from the export of
  // the one table where it carries most: which requirements the amendment touches.
  const proposed: StructuredTableData = {
    columns: ["ID", "Requirement"],
    rows: [
      { id: "r1", ref: "REQ-1", cells: ["REQ-1", "Stop within 40 m."] },
      { id: "r2", cells: ["", "Warn the driver at 20 m."] },
    ] as unknown as StructuredTableData["rows"],
  };
  const described = [{ role: "changed" as const }, { role: "added" as const }];

  it("carries the role column when the roles were derived", () => {
    const exported = tableExport(proposed, nothingHidden, described);
    expect(exported.columns).toEqual(["ID", "Requirement", "change"]);
    expect(exported.rows.map((row) => row.at(-1))).toEqual(["changed", "added"]);
  });

  it("invents no column when there is no role at all", () => {
    expect(tableExport(proposed, nothingHidden).columns).toEqual(["ID", "Requirement"]);
  });

  it("leaves behind what the reader has narrowed away", () => {
    // What leaves is what the reader is looking at — including when the role they
    // filtered on was derived rather than declared.
    const exported = tableExport(proposed, new Set([filterKey("role", "added")]), described);
    expect(exported.rows).toHaveLength(1);
    expect(exported.rows[0].at(-1)).toBe("changed");
    expect(exported.withheld).toBe(1);
  });
});
