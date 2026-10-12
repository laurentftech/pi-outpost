/**
 * A rendered structured-exchange document's exports, offered to whoever shows it.
 *
 * The document decides what leaves — the orientation, viewpoint and hidden elements the
 * reader chose, a timeline's scale, a table's hidden rows — so its own buttons and
 * buttons elsewhere (the file viewer's toolbar) produce the same files.
 */
export interface DocumentExport {
  /** A graph, a sequence or a timeline: save the figure as it is now, as SVG. */
  svg?(): void;
  /** A table: save the rows as shown, as an Excel workbook. */
  xlsx?(): void;
  /** A table: the rows as shown, as Markdown — what a Word export is written from. */
  markdown?(): string;
}
