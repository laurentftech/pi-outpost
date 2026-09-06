/**
 * Handing the browser a file to keep.
 *
 * One place, rather than a copy per export. The two callers — a table leaving as
 * CSV or a workbook, a document leaving as Word — differ in what they build and
 * not at all in how they hand it over, and a second copy of these six lines is
 * how the one that revokes its url and the one that forgets drift apart.
 */
export function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Not leaked: a blob url held for the life of the page holds the file with it.
  URL.revokeObjectURL(url);
}
