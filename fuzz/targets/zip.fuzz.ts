/**
 * Fuzz target: an Office document's zip, as the docx, pptx and xlsx tools open one
 * (`readAllZipEntries`): the central directory, then every entry's local header and inflation.
 *
 * The limits are lower than production's so that a run spends its time on parsing rather than on
 * inflating the largest archive the limits allow; refusing past a limit is a `ZipError`, tested in
 * `office/test`. A `ZipError` is the reader refusing the input and is not a finding. Anything else
 * thrown, a hang or a crash is.
 */
import { readAllZipEntries, ZipError } from "../../office/src/zip.ts";

const LIMITS = { maxEntries: 4096, maxInflatedBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };

export function fuzz(data: Buffer): void {
  try {
    readAllZipEntries(data, LIMITS);
  } catch (error) {
    if (error instanceof ZipError) return;
    throw error;
  }
}
