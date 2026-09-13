/**
 * A table, taken away as data.
 *
 * A graph leaves this application as a picture, because a picture is what it is.
 * A table is not: a reader who wants to keep one wants it where they keep tables,
 * which is a spreadsheet — or, for a specification, a document. Offering them an SVG
 * of a table would be offering a photograph of a document.
 *
 * What leaves is decided in `shared` (`structured-exchange/table-export`), so the
 * reference validator writes the same Markdown a reader downloads. Only the functions
 * that hand the browser a file live here.
 */
import type { StructuredTableData, StructuredTableRowRole } from "@pi-outpost/shared/structured-exchange";
import { tableMarkdown, toCsv, type TableExport } from "@pi-outpost/shared/structured-exchange/table-export";
import { save } from "../util/download";

export { tableExport, tableMarkdown, toCsv, type TableExport } from "@pi-outpost/shared/structured-exchange/table-export";

export function downloadCsv(exported: TableExport, fileName: string): void {
  // The BOM is for Excel and only for Excel: without it, it reads a UTF-8 file as
  // the local code page and a requirement written in French arrives mangled.
  save(new Blob(["﻿", toCsv(exported)], { type: "text/csv;charset=utf-8" }), fileName);
}

/**
 * The same table as a workbook.
 *
 * The writer is imported here rather than at the top of the module so it lands in
 * its own chunk: the widget is a published bundle, and a reader who never exports
 * a table should not download a spreadsheet writer to read a conversation.
 */
export async function downloadXlsx(exported: TableExport, fileName: string): Promise<void> {
  // The `/browser` entry point, not the bare package name: the package's exports
  // map has no root, and Node's and the browser's writers are different files.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = exported.columns.map((column) => ({ value: column, fontWeight: "bold" as const }));
  const rows = exported.rows.map((row) =>
    row.map((cell) => {
      // Written as what it is: a number typed as a string sorts as text, which is
      // the difference between a spreadsheet and a picture of one.
      if (cell === null) return { value: undefined };
      if (typeof cell === "number") return { value: cell, type: Number };
      if (typeof cell === "boolean") return { value: cell, type: Boolean };
      return { value: cell, type: String };
    }),
  );
  // v4 hands back a writer, not a file: `toBlob()` builds the workbook, and the
  // one save path below hands it over — its own `toFile` would be a second.
  const blob = await writeXlsxFile([header, ...rows]).toBlob();
  save(blob, fileName);
}

/** The same table as Markdown: chapters as headings, the rows shown beneath each. */
export function downloadMarkdown(
  data: StructuredTableData,
  hidden: ReadonlySet<string>,
  described: { role?: StructuredTableRowRole }[] | undefined,
  fileName: string,
): void {
  save(new Blob([tableMarkdown(data, hidden, described)], { type: "text/markdown;charset=utf-8" }), fileName);
}
