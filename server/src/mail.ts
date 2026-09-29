/**
 * Reading an email message: an internet message (`.eml`, `.emlx`) or an Outlook
 * compound-file message (`.msg`), reduced to the same neutral shape.
 *
 * Both readers answer with a `MailMessage`: the headers a reader needs, one body
 * with the form it was read from, and an inventory of attachments whose bytes are
 * the sender's bytes. Nothing here writes, and nothing here knows what a `.pptx`
 * is — an attachment becomes a file elsewhere (see mailTool.ts) and the document
 * extractors read it as they read any other file.
 *
 * SECURITY: every byte of the input is attacker-controlled, and a message is the
 * likeliest thing in this system to have been written by someone hostile to its
 * reader. Three consequences run through the module:
 *
 * - Nothing is fetched, resolved or executed. A `cid:`, `http:` or `file:`
 *   reference is text (see mailHtml.ts), and no charset, entity or part lookup
 *   reaches outside these bytes.
 * - Every structural loop is bounded — parts, depth, nesting, time — because
 *   "malformed" here includes "designed to be malformed".
 * - Nothing is guessed at silently. A body that cannot be read says so and names
 *   the forms the message holds, because an empty string is indistinguishable from
 *   a message with nothing in it.
 */
import { reduceHtmlToMarkdown } from "./mailHtml.ts";
// The Outlook reader is a module of its own — a compound file has nothing in common
// with MIME — but `readMessage` stays the single entry point either format goes
// through, so it imports it. The cycle that creates is harmless: every use is inside
// a function body, and neither module touches the other's bindings while loading.
import { readOutlookMessage } from "./mailMsg.ts";

export type MailFormat = "eml" | "emlx" | "msg";

export type MailErrorReason =
  /** Not a message this system recognises, or damaged past reading. */
  | "unreadable"
  /** Encrypted: S/MIME or PGP. No key is held anywhere in this system. */
  | "encrypted"
  /** Parsing exceeded the time budget. */
  | "budget";

export class MailError extends Error {
  constructor(
    readonly reason: MailErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** One mailbox, as the message states it. Nothing here is authenticated. */
export interface MailAddress {
  name?: string;
  address: string;
}

/**
 * Which of the forms a message holds the body was read from. Named in the output
 * because the same message reads differently as HTML and as plain text, and a
 * caller quoting it needs to know which it has.
 */
export type BodyForm = "plain text" | "HTML" | "HTML recovered from rich text" | "rich text";

export interface MailAttachment {
  /**
   * 1-based position among the message's attachments, as a string — the identifier
   * a caller names to unpack one. Stable for a given file because it follows the
   * order the parts appear in, which is a property of the bytes.
   */
  id: string;
  /** The name the message claims. Hostile input: never used as a path as it stands. */
  claimedName?: string;
  mediaType: string;
  /** Bytes of the decoded content, or 0 when it could not be decoded. */
  size: number;
  /** An inline image the body references, rather than a document to open. */
  inline: boolean;
  /** `Content-ID` of an inline part, without its angle brackets. */
  contentId?: string;
  /** Subject of an attached message, which is how a forwarded mail is named. */
  messageSubject?: string;
  /** Why the content could not be read. Such a part is listed, never omitted. */
  unreadable?: string;
  /** Decoded content. Absent when `unreadable` is set. */
  content?: Buffer;
}

export interface MailMessage {
  format: MailFormat;
  subject?: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  /** ISO 8601 when the message's date parses, otherwise the header as written. */
  date?: string;
  /** The body, when one could be read. */
  body?: { markdown: string; form: BodyForm };
  /** Why no body could be read, and which forms the message does hold. */
  bodyUnreadable?: { reason: string; formsHeld: string[] };
  attachments: MailAttachment[];
  /**
   * Anything the reader had to say about how it read this message: a charset it
   * fell back on, a part it could not parse, a signature it did not verify. These
   * reach the caller — a fallback nobody is told about is a wrong answer.
   */
  notes: string[];
  /** A signature is present. Nothing here verifies one. */
  signed: boolean;
}

export interface ReadMessageOptions {
  /** Wall-clock budget for parsing. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
/** A message with more parts than this is pathological, not merely large. */
export const MAX_PARTS = 500;
/** Nesting past this is a bomb, not a mail thread. */
export const MAX_DEPTH = 20;

/** Compound files — an Outlook `.msg` — start with this signature. */
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/* ── Format ─────────────────────────────────────────────────────────────────── */

/**
 * Which reader these bytes need, decided from the bytes.
 *
 * Not from the extension, deliberately: a `.msg` arrives from a Windows share
 * named whatever someone named it, a webmail download is called `message.eml`
 * whatever it holds, and the extension is the one part of the input we know to be
 * unreliable. Eight bytes settle it.
 */
export function sniffFormat(bytes: Buffer): MailFormat {
  if (bytes.length >= CFB_MAGIC.length && bytes.subarray(0, CFB_MAGIC.length).equals(CFB_MAGIC)) return "msg";
  return emlxPrefixLength(bytes) === null ? "eml" : "emlx";
}

/**
 * The length of an `.emlx` file's leading byte-count line, or `null`.
 *
 * Apple Mail writes the message's size on the first line, then the message, then a
 * property list of its own flags. The count is how the message's end is known
 * without guessing where the plist begins.
 */
function emlxPrefixLength(bytes: Buffer): { headerLength: number; messageLength: number } | null {
  const limit = Math.min(bytes.length, 32);
  let at = 0;
  // A run of digits, then a newline. Apple writes a bare LF; tolerate CRLF.
  while (at < limit && bytes[at] >= 0x30 && bytes[at] <= 0x39) at++;
  if (at === 0) return null;
  let end = at;
  if (bytes[end] === 0x0d) end++;
  if (bytes[end] !== 0x0a) return null;
  const messageLength = Number.parseInt(bytes.subarray(0, at).toString("latin1"), 10);
  if (!Number.isFinite(messageLength) || messageLength <= 0) return null;
  // The count must not overrun the file, and a message that is *only* digits and a
  // newline is not an emlx. A short count is accepted: the plist follows.
  if (messageLength > bytes.length - (end + 1)) return null;
  return { headerLength: end + 1, messageLength };
}

/* ── Characters ─────────────────────────────────────────────────────────────── */

/**
 * The 0x80–0x9F range of windows-1252, which is where it differs from Latin-1.
 *
 * Built in rather than delegated, because `TextDecoder`'s support for legacy
 * single-byte encodings depends on the ICU data the runtime was built with — and
 * the standalone executable is exactly where that assumption would break, silently
 * turning an accented French subject into replacement characters. Above 0x9F the
 * two encodings agree with Unicode code points, so the table only needs this hole.
 *
 * Mail labelled `ISO-8859-1` is decoded this way too: the bytes in this range are
 * undefined in Latin-1 and every mail client that emits them means windows-1252,
 * which is also what HTML requires.
 */
const CP1252_HIGH = [
  "€", "\u0081", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", "\u008d", "Ž", "\u008f",
  "\u0090", "‘", "’", "“", "”", "•", "–", "—",
  "˜", "™", "š", "›", "œ", "\u009d", "ž", "Ÿ",
];

function decodeCp1252(bytes: Buffer): string {
  let out = "";
  for (const byte of bytes) {
    out += byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte);
  }
  return out;
}

/**
 * Whether these bytes really were UTF-8.
 *
 * Decided from the decoding rather than by re-scanning: `toString("utf8")` marks
 * every byte it could not read with U+FFFD, so a replacement character that the
 * input did not itself encode is proof the bytes were something else.
 */
function isValidUtf8(bytes: Buffer, decoded: string): boolean {
  if (!decoded.includes("�")) return true;
  return bytes.includes(Buffer.from("�", "utf8"));
}

/** Labels this module decodes itself, in the spelling messages actually use. */
const CP1252_LABELS = new Set([
  "windows-1252", "cp1252", "cp-1252", "1252", "iso-8859-1", "iso8859-1", "iso_8859-1",
  "latin1", "latin-1", "l1", "ansi_x3.4-1968", "us-ascii", "ascii", "iso-ir-100",
]);

const UTF8_LABELS = new Set(["utf-8", "utf8", "unicode-1-1-utf-8", "csutf8"]);

/**
 * Text from bytes, honouring the charset the message declares.
 *
 * A charset nobody here knows falls back to windows-1252 — the decoding least
 * likely to lose a byte, since every byte maps to something — and says so through
 * `note`. Falling back in silence is the failure this signature exists to prevent.
 */
export function decodeText(bytes: Buffer, charset: string | undefined): { text: string; note?: string } {
  const label = (charset ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (label === "" || UTF8_LABELS.has(label)) {
    const text = bytes.toString("utf8");
    // A part that declares UTF-8 — or declares nothing, which is the same guess —
    // and does not hold it. Old clients label everything UTF-8 and send Latin-1, and
    // `toString("utf8")` turns each of those bytes into a replacement character: the
    // accent is not mojibake, it is *gone*. windows-1252 loses no byte, so that is
    // the fallback, and it is stated rather than silent.
    if (!isValidUtf8(bytes, text)) {
      return {
        text: decodeCp1252(bytes),
        note:
          label === ""
            ? "a part declared no character set and its bytes are not UTF-8; it was read as windows-1252"
            : `a part declared "${charset}" but its bytes are not valid UTF-8; it was read as windows-1252`,
      };
    }
    return { text };
  }
  if (CP1252_LABELS.has(label)) return { text: decodeCp1252(bytes) };
  try {
    return { text: new TextDecoder(label, { fatal: false }).decode(bytes) };
  } catch {
    return {
      text: decodeCp1252(bytes),
      note: `character set "${charset}" is not available here; that part was read as windows-1252`,
    };
  }
}

/* ── Transfer encodings ─────────────────────────────────────────────────────── */

/** `quoted-printable` to bytes: soft line breaks vanish, `=XX` is one byte. */
export function decodeQuotedPrintable(input: Buffer): Buffer {
  const out = Buffer.alloc(input.length);
  let length = 0;
  for (let at = 0; at < input.length; at++) {
    const byte = input[at];
    if (byte !== 0x3d) {
      out[length++] = byte;
      continue;
    }
    // A soft line break: "=" at end of line, joining the next line to this one.
    if (input[at + 1] === 0x0d && input[at + 2] === 0x0a) {
      at += 2;
      continue;
    }
    if (input[at + 1] === 0x0a) {
      at += 1;
      continue;
    }
    const hex = input.subarray(at + 1, at + 3).toString("latin1");
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      out[length++] = Number.parseInt(hex, 16);
      at += 2;
      continue;
    }
    // A lone "=" is not an escape. Kept as written: some clients emit it, and
    // dropping it would silently alter the text.
    out[length++] = byte;
  }
  return out.subarray(0, length);
}

/** Base64 to bytes, ignoring the whitespace and the junk a mailer wrapped it in. */
function decodeBase64(input: Buffer): Buffer {
  return Buffer.from(input.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
}

function transferDecode(body: Buffer, encoding: string | undefined): Buffer {
  const name = (encoding ?? "").trim().toLowerCase();
  if (name === "base64") return decodeBase64(body);
  if (name === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

/* ── Headers ────────────────────────────────────────────────────────────────── */

/** Header values by lower-cased name, in the order they appeared. */
export type MailHeaders = Map<string, string[]>;

/**
 * Split an entity into its headers and its body, and unfold the headers.
 *
 * Tolerant of `LF` as well as `CRLF`: a checked-in fixture arrives with whichever
 * the platform's git gave it, and a message copied through a text editor has been
 * seen to lose its carriage returns entirely. Headers are ASCII by definition, so
 * they are read as `latin1` — byte-preserving — and decoded afterwards.
 */
export function splitHeaders(entity: Buffer): { headers: MailHeaders; body: Buffer } {
  let bodyAt = entity.length;
  let headerEnd = entity.length;
  for (let at = 0; at < entity.length; at++) {
    if (entity[at] !== 0x0a) continue;
    const next = entity[at + 1];
    if (next === 0x0a) {
      headerEnd = at;
      bodyAt = at + 2;
      break;
    }
    if (next === 0x0d && entity[at + 2] === 0x0a) {
      headerEnd = at;
      bodyAt = at + 3;
      break;
    }
  }

  const headers: MailHeaders = new Map();
  const lines = entity.subarray(0, headerEnd).toString("latin1").split(/\r?\n/);
  let current: { name: string; value: string } | null = null;
  const commit = () => {
    if (current === null) return;
    const key = current.name.toLowerCase();
    const values = headers.get(key);
    if (values === undefined) headers.set(key, [current.value]);
    else values.push(current.value);
    current = null;
  };
  for (const line of lines) {
    if (line === "") continue;
    // A continuation line begins with whitespace and belongs to the header above.
    if (/^[ \t]/.test(line)) {
      if (current !== null) current.value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue; // not a header line; no useful reading of it
    commit();
    current = { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
  }
  commit();

  return { headers, body: entity.subarray(bodyAt) };
}

function header(headers: MailHeaders, name: string): string | undefined {
  return headers.get(name)?.[0];
}

/**
 * Decode RFC 2047 encoded words in a header value.
 *
 * `=?UTF-8?B?…?=` and `=?ISO-8859-1?Q?…?=`, including a value split across several
 * words — which is how a long accented subject arrives, since each word is limited
 * to 75 characters. Adjacent encoded words are joined with no space between them:
 * the whitespace separating them is the encoding's, not the subject's, and keeping
 * it puts a space in the middle of a word.
 */
export function decodeEncodedWords(value: string): { text: string; note?: string } {
  if (!value.includes("=?")) return { text: value };
  let note: string | undefined;
  const pattern = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  let out = "";
  let at = 0;
  let previousEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const between = value.slice(at, match.index);
    // Whitespace *between two encoded words* is the encoding's separator, not part
    // of the value: each word is limited to 75 characters, so a long subject is
    // split and the space that separates the pieces was never in the subject.
    const isSeparator = previousEnd !== -1 && between !== "" && between.trim() === "";
    if (!isSeparator) out += between;
    const [charsetLabel, encoding, text] = [match[1], match[2].toLowerCase(), match[3]];
    const charset = charsetLabel.split("*", 1)[0];
    const bytes =
      encoding === "b"
        ? decodeBase64(Buffer.from(text, "latin1"))
        : // Q-encoding is quoted-printable with `_` for a space.
          decodeQuotedPrintable(Buffer.from(text.replace(/_/g, " "), "latin1"));
    const decoded = decodeText(bytes, charset);
    note ??= decoded.note;
    out += decoded.text;
    at = match.index + match[0].length;
    previousEnd = at;
  }
  out += value.slice(at);
  return note === undefined ? { text: out } : { text: out, note };
}

/**
 * A structured header's value and parameters: `text/plain; charset="utf-8"`.
 *
 * RFC 2231 continuations (`name*0`, `name*1`) and charset-tagged values
 * (`name*=utf-8''…`) are folded in, because that is how a long or non-ASCII
 * attachment name arrives from anything but Outlook.
 */
export function parseStructured(value: string | undefined): { value: string; params: Record<string, string> } {
  if (value === undefined) return { value: "", params: {} };
  const parts = splitOutsideQuotes(value, ";");
  const params: Record<string, string> = {};
  const continued = new Map<string, { pieces: Map<number, string>; charset?: string; encoded: Set<number> }>();

  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    const rawName = part.slice(0, equals).trim().toLowerCase();
    let raw = part.slice(equals + 1).trim();
    if (raw.startsWith('"')) {
      const closing = raw.lastIndexOf('"');
      raw = closing > 0 ? raw.slice(1, closing) : raw.slice(1);
    }

    const continuation = /^([^*]+)\*(\d+)(\*)?$/.exec(rawName);
    const extended = /^([^*]+)\*$/.exec(rawName);
    if (continuation !== null) {
      const entry = continued.get(continuation[1]) ?? { pieces: new Map<number, string>(), encoded: new Set<number>() };
      const index = Number(continuation[2]);
      let piece = raw;
      if (continuation[3] === "*") {
        // Only the first section carries the charset: charset'language'text
        const tagged = /^([^']*)'([^']*)'(.*)$/.exec(raw);
        if (index === 0 && tagged !== null) {
          entry.charset = tagged[1];
          piece = tagged[3];
        }
        entry.encoded.add(index);
      }
      entry.pieces.set(index, piece);
      continued.set(continuation[1], entry);
      continue;
    }
    if (extended !== null) {
      const tagged = /^([^']*)'([^']*)'(.*)$/.exec(raw);
      if (tagged !== null) {
        params[extended[1]] = decodeText(percentDecode(tagged[3]), tagged[1]).text;
      } else {
        params[extended[1]] = raw;
      }
      continue;
    }
    // An encoded word where a plain parameter belongs is not legal, and Outlook
    // writes one anyway for a non-ASCII attachment name.
    params[rawName] = decodeEncodedWords(raw).text;
  }

  for (const [name, entry] of continued) {
    const indexes = [...entry.pieces.keys()].sort((a, b) => a - b);
    let assembled = "";
    for (const index of indexes) {
      const piece = entry.pieces.get(index) ?? "";
      assembled += entry.encoded.has(index) ? decodeText(percentDecode(piece), entry.charset).text : piece;
    }
    params[name] = assembled;
  }

  return { value: parts[0]?.trim() ?? "", params };
}

/** `%E9` in an RFC 2231 value. Bytes, because the charset decides the characters. */
function percentDecode(text: string): Buffer {
  const out = Buffer.alloc(text.length);
  let length = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "%" && /^[0-9a-fA-F]{2}$/.test(text.slice(at + 1, at + 3))) {
      out[length++] = Number.parseInt(text.slice(at + 1, at + 3), 16);
      at += 2;
      continue;
    }
    out[length++] = text.charCodeAt(at) & 0xff;
  }
  return out.subarray(0, length);
}

/** Split on a separator that is not inside a quoted string or a comment. */
function splitOutsideQuotes(value: string, separator: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let angle = 0;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && char === "<") angle++;
    if (!quoted && char === ">" && angle > 0) angle--;
    if (char === separator && !quoted && angle === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/**
 * The mailboxes in an address header.
 *
 * A display name is decoded on its own — `=?UTF-8?Q?Fran=C3=A7ois?= <f@x.test>`
 * encodes only the name — and a group syntax (`Team: a@x, b@x;`) contributes its
 * members rather than being refused.
 */
export function parseAddresses(value: string | undefined): MailAddress[] {
  if (value === undefined || value.trim() === "") return [];
  const out: MailAddress[] = [];
  for (const piece of splitOutsideQuotes(value.replace(/^[^:<@]{1,64}:(?=.*[<@])/, ""), ",")) {
    const text = piece.replace(/;\s*$/, "").trim();
    if (text === "") continue;
    const angled = /^(.*)<([^<>]*)>\s*$/.exec(text);
    if (angled !== null) {
      const name = decodeEncodedWords(angled[1].trim().replace(/^"(.*)"$/, "$1")).text.trim();
      const address = angled[2].trim();
      out.push(name === "" ? { address } : { name, address });
      continue;
    }
    out.push({ address: decodeEncodedWords(text).text.trim() });
  }
  return out;
}

/* ── MIME structure ─────────────────────────────────────────────────────────── */

interface MimeEntity {
  headers: MailHeaders;
  /** Media type, lower-cased, e.g. "text/plain". Defaults per RFC to text/plain. */
  mediaType: string;
  params: Record<string, string>;
  /** Children of a multipart entity, in order. */
  children: MimeEntity[];
  /** Raw body of a leaf, before transfer decoding. */
  raw: Buffer;
}

export interface ParseState {
  deadline: () => void;
  parts: number;
  notes: string[];
}

/** Parse an entity and, recursively, its parts. */
function parseEntity(entity: Buffer, state: ParseState, depth: number): MimeEntity {
  state.deadline();
  if (++state.parts > MAX_PARTS) throw new MailError("unreadable", `this message has more than ${MAX_PARTS} parts`);

  const { headers, body } = splitHeaders(entity);
  const contentType = parseStructured(header(headers, "content-type"));
  const mediaType = (contentType.value || "text/plain").toLowerCase();
  const node: MimeEntity = { headers, mediaType, params: contentType.params, children: [], raw: body };

  if (mediaType.startsWith("multipart/")) {
    const boundary = contentType.params.boundary;
    if (boundary === undefined || boundary === "") {
      state.notes.push(`a ${mediaType} part declares no boundary; it was read as a single part`);
      return node;
    }
    if (depth >= MAX_DEPTH) {
      state.notes.push(`parts nested deeper than ${MAX_DEPTH} were not read`);
      return node;
    }
    for (const piece of splitMultipart(body, boundary, state)) {
      node.children.push(parseEntity(piece, state, depth + 1));
    }
  }
  return node;
}

/**
 * The parts between a multipart's boundary delimiters.
 *
 * Anything before the first delimiter is the preamble and anything after the
 * closing one is the epilogue; neither is a part. A missing closing delimiter — a
 * truncated message — yields the parts that were there, which is what the caller
 * needs from a truncated message.
 */
function splitMultipart(body: Buffer, boundary: string, state: ParseState): Buffer[] {
  const marker = Buffer.from(`--${boundary}`, "latin1");
  const starts: number[] = [];
  let at = 0;
  while (at <= body.length) {
    state.deadline();
    const found = body.indexOf(marker, at);
    if (found === -1) break;
    // A delimiter is a whole line: at the start of the body, or after a newline.
    if (found === 0 || body[found - 1] === 0x0a) starts.push(found);
    at = found + marker.length;
  }
  if (starts.length === 0) {
    state.notes.push("a multipart part's boundary was never found; it was read as a single part");
    return [];
  }

  const parts: Buffer[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const afterMarker = start + marker.length;
    // "--boundary--" closes the multipart; nothing after it is a part.
    if (body[afterMarker] === 0x2d && body[afterMarker + 1] === 0x2d) break;
    const lineEnd = body.indexOf(0x0a, afterMarker);
    if (lineEnd === -1) break;
    const next = starts[index + 1];
    if (next === undefined) {
      // No closing delimiter: the rest of the body is the last part.
      parts.push(body.subarray(lineEnd + 1));
      state.notes.push("this multipart part has no closing boundary; it was read to the end of the message");
      break;
    }
    // The newline before the next delimiter belongs to the delimiter, not the part.
    let end = next;
    if (body[end - 1] === 0x0a) end--;
    if (body[end - 1] === 0x0d) end--;
    parts.push(body.subarray(lineEnd + 1, Math.max(end, lineEnd + 1)));
  }
  return parts;
}

/* ── Assembling a message ───────────────────────────────────────────────────── */

/** Disposition and name of a part, from either header that carries them. */
function dispositionOf(entity: MimeEntity): { disposition: string; name?: string } {
  const raw = parseStructured(header(entity.headers, "content-disposition"));
  const name = raw.params.filename ?? entity.params.name;
  return { disposition: raw.value.toLowerCase(), name: name === "" ? undefined : name };
}

function contentIdOf(entity: MimeEntity): string | undefined {
  const value = header(entity.headers, "content-id")?.trim();
  if (value === undefined || value === "") return undefined;
  return value.replace(/^<|>$/g, "");
}

/** Is this part a body candidate, or a file the message carries? */
function isAttachmentPart(entity: MimeEntity): boolean {
  const { disposition, name } = dispositionOf(entity);
  if (disposition === "attachment") return true;
  if (entity.mediaType === "message/rfc822" || entity.mediaType === "message/global") return true;
  if (entity.mediaType.startsWith("multipart/")) return false;
  // A text part is the body unless it names a file.
  //
  // `inline` does NOT make it one, which is the whole point of this line: a great many
  // mailers mark the body part `Content-Disposition: inline`, and an earlier version
  // read that as "a file the message carries" — so the message came back with its text
  // listed as an attachment and its body reported unreadable. Every test here used
  // parts with no disposition header at all, so nothing caught it.
  if (entity.mediaType.startsWith("text/")) return name !== undefined;
  // An inline image with a Content-ID is referenced by the body; anything else with
  // a name is a file. A nameless non-text part is still a file — it has no other
  // reading — and is listed so that nothing the message carries goes unseen.
  return true;
}

interface Collected {
  plain: { entity: MimeEntity; text: string }[];
  html: { entity: MimeEntity; text: string }[];
  attachments: MailAttachment[];
  formsHeld: Set<string>;
}

/**
 * Walk the tree, sorting parts into body candidates and attachments.
 *
 * `multipart/alternative` is *not* resolved here: every candidate is collected and
 * the choice is made once, in `chooseBody`, because the preference rule needs to
 * see both forms to tell a real plain-text part from a stub.
 */
function collect(entity: MimeEntity, state: ParseState, into: Collected, message: MailMessage): void {
  state.deadline();

  if (entity.mediaType === "multipart/signed") {
    message.signed = true;
    message.notes.push("this message carries a signature, which was not verified");
    // The first part is what the signature covers; the last is the signature.
    if (entity.children.length > 0) collect(entity.children[0], state, into, message);
    return;
  }
  if (entity.children.length > 0) {
    for (const child of entity.children) collect(child, state, into, message);
    return;
  }

  const decoded = transferDecode(entity.raw, header(entity.headers, "content-transfer-encoding"));

  if (isAttachmentPart(entity)) {
    const { name } = dispositionOf(entity);
    const contentId = contentIdOf(entity);
    const inline = dispositionOf(entity).disposition === "inline" || (contentId !== undefined && entity.mediaType.startsWith("image/"));
    const attachment: MailAttachment = {
      id: String(into.attachments.length + 1),
      mediaType: entity.mediaType,
      size: decoded.length,
      inline,
      content: decoded,
    };
    if (name !== undefined) attachment.claimedName = name;
    if (contentId !== undefined) attachment.contentId = contentId;
    if (entity.mediaType === "message/rfc822" || entity.mediaType === "message/global") {
      // A forwarded message is named by its subject, which is inside it.
      const inner = splitHeaders(decoded);
      const subject = header(inner.headers, "subject");
      if (subject !== undefined) attachment.messageSubject = decodeEncodedWords(subject).text;
    }
    if (decoded.length === 0) attachment.unreadable = "its content is empty or could not be decoded";
    into.attachments.push(attachment);
    return;
  }

  if (entity.mediaType === "text/html") {
    into.formsHeld.add("HTML");
    const { text, note } = decodeText(decoded, entity.params.charset);
    if (note !== undefined) message.notes.push(note);
    into.html.push({ entity, text });
    return;
  }
  if (entity.mediaType.startsWith("text/")) {
    into.formsHeld.add(entity.mediaType === "text/plain" ? "plain text" : entity.mediaType);
    const { text, note } = decodeText(decoded, entity.params.charset);
    if (note !== undefined) message.notes.push(note);
    into.plain.push({ entity, text });
    return;
  }

  // A leaf that is neither text nor recognisably a file: listed, so that a caller
  // reading the inventory sees everything the message holds.
  into.attachments.push({
    id: String(into.attachments.length + 1),
    mediaType: entity.mediaType,
    size: decoded.length,
    inline: false,
    content: decoded,
  });
}

/**
 * Whether a plain-text part is a stub standing in for the HTML one.
 *
 * Marketing mail and Outlook both emit a plain part that says nothing — "view this
 * message in your browser", or a single line of a newsletter — beside an HTML part
 * carrying the message. Preferring plain text unconditionally would return the
 * stub, so the rule is: plain text wins unless it is both very short and much
 * shorter than the HTML beside it.
 */
function looksLikeStub(plain: string, html: string): boolean {
  const text = plain.trim();
  if (text === "") return true;
  if (/view (this|the) (message|e-?mail|newsletter) (in|with)/i.test(text)) return true;
  const htmlText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length < 400 && htmlText.length > 0 && text.length < htmlText.length / 4;
}

function chooseBody(into: Collected, state: ParseState, message: MailMessage): void {
  const plain = into.plain.map((candidate) => candidate.text).join("\n\n").trim();
  const html = into.html.map((candidate) => candidate.text).join("\n").trim();

  if (plain !== "" && (html === "" || !looksLikeStub(plain, html))) {
    message.body = { markdown: normalisePlainText(plain), form: "plain text" };
    return;
  }
  if (html !== "") {
    const markdown = reduceHtmlToMarkdown(html, { deadline: state.deadline });
    if (markdown.trim() !== "") {
      message.body = { markdown, form: "HTML" };
      return;
    }
    // HTML that reduced to nothing at all: the plain part, however thin, is better
    // than reporting an empty body.
    if (plain !== "") {
      message.body = { markdown: normalisePlainText(plain), form: "plain text" };
      return;
    }
  }
  if (plain !== "") {
    message.body = { markdown: normalisePlainText(plain), form: "plain text" };
    return;
  }
  message.bodyUnreadable = {
    reason: into.formsHeld.size === 0 ? "this message carries no body part" : "no body part could be read",
    formsHeld: [...into.formsHeld],
  };
}

/**
 * A plain-text body, left as it stands.
 *
 * Only line endings are touched: `CRLF` becomes `LF` so the text reads the same
 * however it travelled. The quoted history a reply carries is *not* stripped —
 * which part of a thread matters is the reader's judgement — and its `>` prefixes
 * already mark it as quoted, which is exactly what the markdown means.
 */
function normalisePlainText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

/** Encrypted mail: recognised so it can be refused with the reason, not the bytes. */
function assertNotEncrypted(entity: MimeEntity): void {
  const smime = parseStructured(header(entity.headers, "content-type"));
  const smimeType = (smime.params["smime-type"] ?? "").toLowerCase();
  if (entity.mediaType === "multipart/encrypted" || entity.mediaType === "application/pgp-encrypted") {
    throw new MailError("encrypted", "this message is PGP-encrypted and no key is held here");
  }
  if (
    (entity.mediaType === "application/pkcs7-mime" || entity.mediaType === "application/x-pkcs7-mime") &&
    smimeType !== "signed-data"
  ) {
    throw new MailError("encrypted", "this message is S/MIME-encrypted and no key is held here");
  }
  for (const child of entity.children) assertNotEncrypted(child);
  if (entity.children.length === 0 && entity.mediaType.startsWith("text/")) {
    const opening = entity.raw.subarray(0, 512).toString("latin1");
    if (opening.includes("-----BEGIN PGP MESSAGE-----")) {
      throw new MailError("encrypted", "this message is PGP-encrypted and no key is held here");
    }
  }
}

/* ── The internet message reader ─────────────────────────────────────────────── */

/**
 * One of these must be present for a file to be read as an internet message.
 *
 * `Received` and `Return-Path` are here because a message pulled straight off a
 * server may carry nothing else; `Content-Type` because a `.eml` exported from a
 * client sometimes carries only that and a body.
 */
const MESSAGE_HEADERS = [
  "from", "sender", "to", "cc", "bcc", "subject", "date", "message-id",
  "content-type", "mime-version", "received", "return-path",
];

function readInternetMessage(bytes: Buffer, format: MailFormat, state: ParseState): MailMessage {
  const root = parseEntity(bytes, state, 0);
  // A message is recognised by carrying at least one header a message must have.
  // Without this, any text file whose lines happen to contain colons parses as a
  // message with peculiar headers and an empty body, and the caller is told nothing.
  if (!MESSAGE_HEADERS.some((name) => root.headers.has(name))) {
    throw new MailError("unreadable", "this file carries no message headers; it is not an email message");
  }

  const message: MailMessage = { format, to: [], cc: [], bcc: [], attachments: [], notes: [], signed: false };

  assertNotEncrypted(root);

  const subject = header(root.headers, "subject");
  if (subject !== undefined) {
    const decoded = decodeEncodedWords(subject);
    message.subject = decoded.text;
    if (decoded.note !== undefined) message.notes.push(decoded.note);
  }
  const from = parseAddresses(header(root.headers, "from") ?? header(root.headers, "sender"));
  if (from.length > 0) message.from = from[0];
  message.to = parseAddresses(header(root.headers, "to"));
  message.cc = parseAddresses(header(root.headers, "cc"));
  message.bcc = parseAddresses(header(root.headers, "bcc"));

  const date = header(root.headers, "date");
  if (date !== undefined && date !== "") {
    const parsed = new Date(date);
    message.date = Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
  }

  // An opaque S/MIME signature hides the content inside a PKCS#7 blob this system
  // does not open. Recognised here so the message is reported honestly rather than
  // read as an empty one.
  const opaqueSigned =
    (root.mediaType === "application/pkcs7-mime" || root.mediaType === "application/x-pkcs7-mime") &&
    (parseStructured(header(root.headers, "content-type")).params["smime-type"] ?? "").toLowerCase() === "signed-data";
  if (opaqueSigned) {
    message.signed = true;
    message.notes.push("this message carries a signature, which was not verified");
    message.bodyUnreadable = {
      reason: "its content is wrapped in an opaque S/MIME signature, which this system does not open",
      formsHeld: ["opaque S/MIME (application/pkcs7-mime)"],
    };
    return message;
  }

  const into: Collected = { plain: [], html: [], attachments: [], formsHeld: new Set() };
  collect(root, state, into, message);
  message.attachments = into.attachments;
  chooseBody(into, state, message);
  // Deduplicated: one malformed multipart can raise the same note for every part it
  // holds, and a note repeated twenty times reads as twenty problems.
  for (const note of state.notes) {
    if (!message.notes.includes(note)) message.notes.push(note);
  }

  return message;
}

/* ── Entry point ────────────────────────────────────────────────────────────── */

/**
 * Read a message from its bytes.
 *
 * Throws `MailError` for a file that is not a message, one that is encrypted, and
 * one that could not be parsed inside the time budget. Everything softer than that
 * — a part that would not decode, a charset that had to be guessed, a missing
 * closing boundary — is reported in `notes` alongside whatever was read.
 */
export function readMessage(bytes: Buffer, options: ReadMessageOptions = {}): MailMessage {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const state: ParseState = {
    deadline: () => {
      if (Date.now() - started > timeoutMs) {
        throw new MailError("budget", `reading this message exceeded the ${timeoutMs} ms budget`);
      }
    },
    parts: 0,
    notes: [],
  };

  const format = sniffFormat(bytes);
  if (format === "msg") return readOutlookMessage(bytes, state);
  if (format === "emlx") {
    const prefix = emlxPrefixLength(bytes);
    if (prefix !== null) {
      const message = bytes.subarray(prefix.headerLength, prefix.headerLength + prefix.messageLength);
      return readInternetMessage(message, "emlx", state);
    }
  }
  return readInternetMessage(bytes, format, state);
}
