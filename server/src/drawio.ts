/**
 * draw.io files on the server: reading and checking are shared (`@pi-outpost/shared/drawio/*`),
 * and the server adds what only it has, an inflater for compressed pages under a cap.
 */
import { inflateRawSync } from "node:zlib";
import { checkDrawio as checkShared } from "@pi-outpost/shared/drawio/check";
import { DrawioReadError, MAX_INFLATED_PAGE_BYTES, readDrawio as readShared, type DrawioPage, type DrawioReport } from "@pi-outpost/shared/drawio/read";

export * from "@pi-outpost/shared/drawio/read";
export { checkPages, describeDrawioReport, FIX_ORDER, SAME_LINE, SHARED_RUN } from "@pi-outpost/shared/drawio/check";

/** The model of a compressed page: base64 → raw inflate → URI-decoded XML. */
export function inflatePage(text: string): string {
  const compact = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new DrawioReadError("its content is neither a <mxGraphModel> nor compressed draw.io data");
  let inflated: Buffer;
  try {
    inflated = inflateRawSync(Buffer.from(compact, "base64"), { maxOutputLength: MAX_INFLATED_PAGE_BYTES });
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? `it inflates past ${MAX_INFLATED_PAGE_BYTES / (1024 * 1024)} MB` : "its compressed data is damaged";
    throw new DrawioReadError(reason);
  }
  try {
    return decodeURIComponent(inflated.toString("latin1"));
  } catch {
    // Some writers deflate the XML itself rather than its URI encoding
    return inflated.toString("utf8");
  }
}

/** The pages of a draw.io file, compressed pages included. Throws `DrawioReadError` when draw.io could not open it. */
export function readDrawio(xml: string): DrawioPage[] {
  return readShared(xml, inflatePage);
}

/** Read and check a draw.io file. Throws `DrawioReadError` when it cannot be read at all. */
export function checkDrawio(xml: string): DrawioReport {
  return checkShared(xml, inflatePage);
}
