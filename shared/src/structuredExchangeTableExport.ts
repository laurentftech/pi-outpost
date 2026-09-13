/**
 * A table, taken away as data — pure, so it runs wherever a table has to leave.
 *
 * The reader's CSV and workbook, the reader's Markdown, and the reference validator's
 * reports all start here. The rows that leave are decided once — the rows shown, each
 * with the role the reader sees — so a CSV, a workbook and a Markdown file of the same
 * table can never disagree, and the validator writes the Markdown a reader would.
 */
import {
  readTableRow,
  type StructuredTableCell,
  type StructuredTableData,
  type StructuredTableRowRole,
} from "./structuredExchange.ts";
import { filterKey, TABLE_ROLE_LABEL, tableDeclaresRoles, tableRowRole } from "./structuredExchangeModel.ts";

/** The declared column for a row's role — named as the key names it. */
const ROLE_COLUMN = "change";

/**
 * The declared columns for a chapter, present only in a table that has chapters.
 *
 * A structural row has no cells, so without these it leaves as a blank line and the
 * document loses its sections — which is most of what makes a specification
 * readable. Level travels as a number rather than as indentation or a `#` prefix:
 * a spreadsheet sorts and filters on a column, and neither of those survives a
 * convention invented here.
 *
 * The section is *not* copied onto the rows beneath it. A row follows a heading; it
 * does not declare that it belongs to one, and writing membership into every row
 * would state something the document never said.
 */
const SECTION_COLUMN = "section";
const LEVEL_COLUMN = "level";

export type TableExport = {
  columns: string[];
  rows: StructuredTableCell[][];
  /** Rows the reader has narrowed away, and which the export therefore leaves out. */
  withheld: number;
};

/** The rows as they are shown, and the role each carries in the rendering. */
interface ShownRows {
  shown: { row: StructuredTableData["rows"][number]; role: StructuredTableRowRole | undefined }[];
  anyRole: boolean;
  withheld: number;
}

/**
 * Which rows leave, and with which role.
 *
 * `described` is the rows as the reader sees them, when a proposal derived their roles.
 * A proposed table declares no role on any row — declaring one beside a change is
 * refused — so asking the data alone dropped the role from the export of the one table
 * where it carries the most: which requirements the amendment touches.
 */
function shownRows(
  data: StructuredTableData,
  hidden: ReadonlySet<string>,
  described?: { role?: StructuredTableRowRole }[],
): ShownRows {
  const declaresRoles = tableDeclaresRoles(data);
  const roleOf = (row: StructuredTableData["rows"][number], index: number): StructuredTableRowRole | undefined =>
    described?.[index]?.role ?? tableRowRole(row, declaresRoles);
  const anyRole = data.rows.some((row, index) => roleOf(row, index) !== undefined);
  const shown = data.rows
    .map((row, index) => ({ row, role: roleOf(row, index) }))
    .filter(({ role }) => role === undefined || !hidden.has(filterKey("role", role)));
  return { shown, anyRole, withheld: data.rows.length - shown.length };
}

/**
 * What a CSV or workbook export carries: the columns as declared, the rows as shown.
 *
 * The role travels as a column of its own, because the thing that states it in the
 * rendering is a colour and a colour does not survive the crossing. Only when the
 * table declares roles at all — a plain table exports the columns its producer
 * declared and nothing this application invented.
 */
export function tableExport(
  data: StructuredTableData,
  hidden: ReadonlySet<string>,
  described?: { role?: StructuredTableRowRole }[],
): TableExport {
  const { shown, anyRole, withheld } = shownRows(data, hidden, described);
  const hasChapters = data.rows.some((row) => readTableRow(row).heading !== undefined);

  const columns = [
    ...(hasChapters ? [SECTION_COLUMN, LEVEL_COLUMN] : []),
    ...data.columns,
    ...(anyRole ? [ROLE_COLUMN] : []),
  ];

  return {
    columns,
    rows: shown.map(({ row, role }) => {
      const { cells, heading } = readTableRow(row);
      const depth = Array.isArray(row) ? undefined : (row as { depth?: number }).depth;
      // A chapter keeps its place in the sequence and fills the columns it has:
      // its own, and none of the data ones, because it has no data.
      const leading = hasChapters
        ? heading === undefined
          ? [null, null]
          : [heading, depth ?? 1]
        : [];
      const body = heading === undefined ? cells : data.columns.map(() => null);
      return [...leading, ...body, ...(anyRole ? [role === undefined ? null : TABLE_ROLE_LABEL[role]] : [])];
    }),
    withheld,
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

/**
 * One value in a Markdown table cell, reading as it was declared.
 *
 * A pipe would end the cell, a backslash would escape whatever follows, and a newline
 * would end the row: each is written so the table keeps its shape and the value its
 * meaning. `null` is an empty cell, as in the CSV.
 */
function markdownCell(cell: StructuredTableCell): string {
  if (cell === null) return "";
  return String(cell).replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

/** A heading's text on one line; a newline in it would end the heading and start a paragraph. */
function markdownHeading(text: string): string {
  return text.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, " ");
}

/**
 * The table as Markdown: each chapter a heading, the rows beneath it a table of their own.
 *
 * A heading at depth `d` is written at level `d + 1`, leaving level 1 to whatever the
 * Markdown is placed in — a report's title, a document's. Rows before the first heading
 * form a table of their own. A table with no rows still leaves its header, so an empty
 * export says what its columns would have been.
 */
export function tableMarkdown(
  data: StructuredTableData,
  hidden: ReadonlySet<string> = new Set(),
  described?: { role?: StructuredTableRowRole }[],
): string {
  const { shown, anyRole } = shownRows(data, hidden, described);
  const columns = [...data.columns, ...(anyRole ? [ROLE_COLUMN] : [])];
  const header = `| ${columns.map((column) => markdownCell(column)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;

  const blocks: string[] = [];
  let pending: string[] = [];
  let wroteTable = false;
  const flush = () => {
    if (pending.length === 0) return;
    blocks.push([header, separator, ...pending].join("\n"));
    pending = [];
    wroteTable = true;
  };

  for (const { row, role } of shown) {
    const { cells, heading } = readTableRow(row);
    if (heading !== undefined) {
      flush();
      const depth = Array.isArray(row) ? 1 : ((row as { depth?: number }).depth ?? 1);
      blocks.push(`${"#".repeat(Math.min(depth + 1, 6))} ${markdownHeading(heading)}`);
      continue;
    }
    const values = [...cells, ...(anyRole ? [role === undefined ? null : TABLE_ROLE_LABEL[role]] : [])];
    pending.push(`| ${values.map(markdownCell).join(" | ")} |`);
  }
  flush();
  if (!wroteTable && blocks.length === 0) blocks.push([header, separator].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}
