/**
 * A table, taken away as data.
 *
 * A graph leaves this application as a picture, because a picture is what it is.
 * A table is not: a reader who wants to keep one wants it where they keep tables,
 * which is a spreadsheet. Offering them an SVG of a table would be offering a
 * photograph of a document.
 *
 * Everything here is pure except the two functions that hand the browser a file —
 * the shape of an export is decided in one place and both formats are written
 * from it, so a CSV and a workbook of the same table can never disagree.
 */
import {
  readTableRow,
  type StructuredTableCell,
  type StructuredTableData,
} from "@pi-outpost/shared/structured-exchange";
import { filterKey, TABLE_ROLE_LABEL, tableDeclaresRoles, tableRowRole } from "./structuredExchange";
import { save } from "../util/download";

/** The declared column for a row's role — named as the key names it. */
const ROLE_COLUMN = "change";

export type TableExport = {
  columns: string[];
  rows: StructuredTableCell[][];
  /** Rows the reader has narrowed away, and which the export therefore leaves out. */
  withheld: number;
};

/**
 * What an export carries: the columns as declared, the rows as shown.
 *
 * The role travels as a column of its own, because the thing that states it in
 * the rendering is a colour and a colour does not survive the crossing. Only when
 * the table declares roles at all — a plain table exports the columns its producer
 * declared and nothing this application invented.
 */
export function tableExport(data: StructuredTableData, hidden: ReadonlySet<string>): TableExport {
  const declaresRoles = tableDeclaresRoles(data);
  const shown = data.rows.filter((row) => {
    const role = tableRowRole(row, declaresRoles);
    return role === undefined || !hidden.has(filterKey("role", role));
  });

  return {
    columns: declaresRoles ? [...data.columns, ROLE_COLUMN] : [...data.columns],
    rows: shown.map((row) => {
      const cells = readTableRow(row).cells;
      const role = tableRowRole(row, declaresRoles);
      return role === undefined ? cells : [...cells, TABLE_ROLE_LABEL[role]];
    }),
    withheld: data.rows.length - shown.length,
  };
}

/**
 * One field of a comma-separated file.
 *
 * A requirement is prose, and prose carries commas, quotation marks and the
 * occasional newline — written raw, any one of them turns one row into two or
 * shifts every column after it. `null` is an empty field rather than the word
 * "null", which is a value a spreadsheet would then sort and filter on.
 */
function csvField(cell: StructuredTableCell): string {
  if (cell === null) return "";
  const text = String(cell);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CRLF between rows: what the format says, and what a spreadsheet expects. */
export function toCsv(exported: TableExport): string {
  return [exported.columns, ...exported.rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

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
