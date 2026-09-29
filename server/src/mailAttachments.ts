/**
 * Turning a message's attachments into workspace files.
 *
 * This is what makes an emailed deck readable: `pptx_extract` opens a file at a
 * path, so the attachment has to become one. Nothing here knows anything about the
 * formats — it writes bytes and returns paths.
 *
 * SECURITY — read this before touching the naming. An attachment's name is chosen
 * by whoever sent the message, and it arrives having passed through no check at all:
 * `../../.ssh/authorized_keys`, `C:\Windows\System32\drivers\etc\hosts`, `..`, a name
 * made of control characters, a name 4 KiB long, `CON.txt`. The name written is
 * *derived* from it rather than used, and derived down to a single path component, so
 * the only thing a hostile name can cost is a less recognisable file name.
 *
 * Beyond that, every destination goes through the same symlink-safe checks the rest
 * of this system writes through (`assertWritableDestination` in extractionOutput.ts),
 * and every file is created with `wx` — so an existing file is a refusal rather than
 * an overwrite, and there is no stat/write window in between.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { assertWritableDestination } from "./extractionOutput.ts";
import type { MailAttachment } from "./mail.ts";

/** What one attachment's unpacking did. Reported per attachment, never as a total. */
export interface UnpackedAttachment {
  id: string;
  claimedName?: string;
  /** The name actually written, when it was written. */
  writtenName?: string;
  /** Workspace-relative path of the file, when one exists now. */
  path?: string;
  bytes?: number;
  /** Why this attachment was not written. The others are unaffected. */
  error?: string;
}

/** Longest name written, in bytes: the common single-component filesystem limit. */
const MAX_NAME_BYTES = 200;

/** Reserved on Windows whatever the extension, and a workspace is shared. */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Extensions for the types a message labels its attachments with. */
const EXTENSION_FOR_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/zip": "zip",
  "application/json": "json",
  "message/rfc822": "eml",
  "application/vnd.ms-outlook": "msg",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/html": "html",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/**
 * A name safe to write, derived from the name the message claims.
 *
 * The extension is preserved deliberately: it is how the model decides which reader
 * to open the file with, so losing it would leave a readable document unreadable. A
 * name that survives nothing is replaced by one built from the identifier and the
 * media type, which is still a name that says what the file is.
 *
 * The identifier is prefixed to every name. Two attachments called `image001.png` —
 * which is what Outlook names every inline image — would otherwise collide inside one
 * message, and the second would be refused for a reason that has nothing to do with
 * the caller.
 */
export function safeAttachmentName(attachment: MailAttachment): string {
  const claimed = attachment.claimedName ?? "";
  // Both separators, whatever platform this runs on: the name came from elsewhere.
  // This also takes care of "../../x" and of "C:\dir\x", since only the last
  // component survives.
  const base = claimed.split(/[/\\]/).pop() ?? "";
  let name = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Refused on Windows, and a workspace gets synced to one.
    .replace(/[<>:"|?*]/g, "_")
    // Win32 strips trailing dots and spaces, so a name ending in one addresses a
    // different file than it appears to.
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();

  // The extension *in the name* and the extension the type implies are two different
  // things, and only the first one is part of the name. Subtracting the second from
  // the stem is how `contrat` labelled `application/pdf` became `_con.pdf`.
  const inName = /\.([A-Za-z0-9]{1,12})$/.exec(name)?.[1] ?? "";
  const extension = inName === "" ? (EXTENSION_FOR_TYPE[attachment.mediaType.split(";", 1)[0].trim()] ?? "") : inName.toLowerCase();

  let stem = inName === "" ? name : name.slice(0, name.length - inName.length - 1);
  if (RESERVED_NAMES.has(stem.toLowerCase())) stem = `_${stem}`;
  if (stem === "") stem = `attachment-${attachment.id}`;

  // Truncated on the stem so the extension always survives, and measured in bytes
  // because a name of accented characters is longer than it looks.
  const suffix = extension === "" ? "" : `.${extension}`;
  const prefix = `${attachment.id}-`;
  const room = MAX_NAME_BYTES - Buffer.byteLength(prefix, "utf8") - Buffer.byteLength(suffix, "utf8");
  while (Buffer.byteLength(stem, "utf8") > room) stem = stem.slice(0, -1);

  return `${prefix}${stem}${suffix}`;
}

/**
 * Where a message's attachments are written: a directory beside the message, named
 * after it.
 *
 * Derived from the message's own path so that two messages carrying `report.pdf`
 * cannot collide, and so a file's origin is legible from where it sits. Built with
 * `path.join`, not by concatenation — a workspace path on Windows is not a URL.
 */
export function attachmentDirectoryFor(messagePath: string): string {
  const normalised = messagePath.replace(/\\/g, "/");
  const directory = path.posix.dirname(normalised);
  const base = path.posix.basename(normalised);
  // Kept as a posix-style relative path: this is a *workspace* path, the same kind
  // the model passes back to the other read tools, and those are `/`-separated.
  return directory === "." || directory === "" ? `${base}.attachments` : `${directory}/${base}.attachments`;
}

export interface UnpackOptions {
  /** Paths are resolved against this, as the message's own path is. */
  cwd: string;
  /** Zone the destination must land in. `null` means writing is disabled. */
  writableRoot: string | null;
  /** Workspace path of the message being unpacked, as the caller named it. */
  messagePath: string;
}

/**
 * Write the requested attachments beside the message.
 *
 * Throws only for a request that cannot be honoured at all — writing disabled, a
 * destination outside the writable zone, an identifier naming nothing. Everything
 * else is per attachment: one that cannot be written contributes an `error` and the
 * rest are still written, because a message with six attachments and one bad name
 * should not lose the other five.
 */
export async function unpackAttachments(
  attachments: MailAttachment[],
  request: string[] | "all",
  options: UnpackOptions,
): Promise<UnpackedAttachment[]> {
  const wanted =
    request === "all"
      ? attachments
      : request.map((id) => {
          const found = attachments.find((attachment) => attachment.id === id);
          // Refused rather than skipped: a result that quietly omits what was asked
          // for reads as though the attachment did not exist.
          if (found === undefined) {
            throw new Error(
              `No attachment ${id} in this message. It has ${attachments.length === 0 ? "none" : `${attachments.length}: ${attachments.map((attachment) => attachment.id).join(", ")}`}.`,
            );
          }
          return found;
        });
  if (wanted.length === 0) return [];

  const directory = attachmentDirectoryFor(options.messagePath);
  // Checked before anything is created: a refusal must not leave a directory the
  // user never asked for. This is also what refuses a read-only sandbox, and what
  // catches a destination that leaves the writable zone through a symlink.
  const resolvedDirectory = await assertWritableDestination(directory, options);
  await fs.mkdir(resolvedDirectory, { recursive: true });

  const out: UnpackedAttachment[] = [];
  for (const attachment of wanted) {
    const entry: UnpackedAttachment = { id: attachment.id };
    if (attachment.claimedName !== undefined) entry.claimedName = attachment.claimedName;

    if (attachment.content === undefined) {
      entry.error = attachment.unreadable ?? "its content could not be read";
      out.push(entry);
      continue;
    }

    const name = safeAttachmentName(attachment);
    const destination = `${directory}/${name}`;
    try {
      // SECURITY: resolved again, after the mkdir. `assertWritableDestination`
      // resolves the part of the path that exists and keeps the rest as written, so
      // for a directory that did not exist yet the tail was never checked against a
      // real inode — and between that check and this write it can be replaced by a
      // symlink. Checking again closes the window, and the path that survives is the
      // one written to. This is the same order fileBrowser.ts uses for an upload.
      const resolved = await assertWritableDestination(destination, options);
      await fs.writeFile(resolved, attachment.content, { flag: "wx" });
      entry.writtenName = name;
      entry.path = destination;
      entry.bytes = attachment.content.length;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Not an overwrite, and not a failure the caller can do anything about: the
        // file is already there, which is what they wanted it for.
        entry.error = `"${destination}" already exists and was left untouched; read it there.`;
        entry.path = destination;
      } else {
        entry.error = `could not be written: ${(error as Error).message}`;
      }
    }
    out.push(entry);
  }
  return out;
}
