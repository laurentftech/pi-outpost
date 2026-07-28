/**
 * File attached before sending: images go to the model, dropped text files are inlined,
 * and a previewed text file travels as an `@path` reference. The agent browses the same
 * root as the file viewer, so it can read a previewed file itself — inlining it would
 * spend the context window on content the user may never ask about.
 */
export interface Attachment {
  name: string;
  kind: "image" | "text" | "path";
  /** base64 (image), plain text (text file), or a browser-root-relative path (path) */
  data: string;
  mimeType: string;
  /** Preview attachments are replaced when the user previews another file. */
  source?: "manual" | "preview";
  /** Browser-root-relative identity of the file that supplied a preview attachment. */
  previewPath?: string;
}

export const MAX_TEXT_FILE_BYTES = 512 * 1024;
// Must stay under the server's 10 MB base64 cap (base64 ≈ 4/3 × raw): 7 MB raw ≈ 9.8 MB base64
export const MAX_IMAGE_FILE_BYTES = 7 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function filesToAttachments(
  files: Iterable<File>,
): Promise<{ attachments: Attachment[]; errors: string[] }> {
  const attachments: Attachment[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        errors.push(`${file.name}: image too large (max 7 MB)`);
        continue;
      }
      attachments.push({ name: file.name, kind: "image", data: await readAsBase64(file), mimeType: file.type, source: "manual" });
    } else if (file.size <= MAX_TEXT_FILE_BYTES) {
      const text = await file.text();
      if (text.includes("\0")) errors.push(`${file.name}: unsupported binary file`);
      else attachments.push({ name: file.name, kind: "text", data: text, mimeType: file.type || "text/plain", source: "manual" });
    } else {
      errors.push(`${file.name}: file too large (max 512 KB for text)`);
    }
  }
  return { attachments, errors };
}

/**
 * Turns the file shown in the viewer into a path reference for the composer. No size
 * limit applies: the prompt carries the path, and the agent reads whatever it needs.
 */
export function textPreviewToAttachment(path: string): Attachment {
  return { ...pathAttachment(path), source: "preview", previewPath: path };
}

/**
 * Already-typed `@src/App.tsx` — an attachment chip must not add it a second time.
 * Sentence punctuation may follow the path ("…@src/App.tsx, please"), but another
 * path character must not: `@src/App.tsx.bak` names a different file.
 */
function mentions(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)@${escaped}[,.;:!?)\\]]*(\\s|$)`).test(text);
}

/**
 * Paths the user named with `@` in their draft. They reference a file just as an
 * attachment does, so the tree marks them too — the file tree cannot see the composer's
 * text on its own. Trailing sentence punctuation is not part of the path.
 */
export function mentionedPaths(text: string): string[] {
  const found = text.matchAll(/(?:^|\s)@([^\s@]+)/g);
  return [...found].map(([, path]) => path.replace(/[,.;:!?)\]]+$/, "")).filter((path) => path.length > 0);
}

/**
 * The prompt the composer sends: typed text, then previewed paths as `@` mentions and
 * dropped text files as fenced blocks. Images ride alongside as WireImage values.
 */
export function composePrompt(text: string, attachments: Attachment[]): string {
  let full = text.trim();
  const append = (part: string) => {
    full += `${full ? "\n\n" : ""}${part}`;
  };
  for (const attachment of attachments) {
    if (attachment.kind === "path") {
      if (!mentions(full, attachment.data)) append(`@${attachment.data}`);
    } else if (attachment.kind === "text") {
      append(`\`\`\`${attachment.name}\n${attachment.data}\n\`\`\``);
    }
  }
  return full;
}

/** Fetches an image through the same confined raw-file endpoint the viewer uses. */
export async function imagePreviewToAttachment(path: string, url: string): Promise<Attachment | string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return `${path}: unable to read preview image for attachment`;
    const mimeType = response.headers.get("Content-Type")?.split(";", 1)[0] ?? "";
    if (!mimeType.startsWith("image/")) return `${path}: preview is not a supported image attachment`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_FILE_BYTES) return `${path}: image too large (max 7 MB)`;
    return { name: path, kind: "image", data: bytesToBase64(bytes), mimeType, source: "preview", previewPath: path };
  } catch {
    return `${path}: unable to read preview image for attachment`;
  }
}

/** A file picked in the tree: referenced by path, so it stays alongside the preview's own reference. */
export function pathAttachment(path: string): Attachment {
  return { name: path, kind: "path", data: path, mimeType: "text/plain", source: "manual" };
}

/** Adds a path reference unless that path is already attached (from the tree or the preview). */
export function addPathAttachment(attachments: Attachment[], path: string): Attachment[] {
  if (attachments.some((current) => current.kind === "path" && current.data === path)) return attachments;
  return [...attachments, pathAttachment(path)];
}

/** Replaces only the automatic preview attachment, preserving manual files. */
export function replacePreviewAttachment(attachments: Attachment[], attachment: Attachment): Attachment[] {
  return [...attachments.filter((current) => current.source !== "preview"), attachment];
}

/** Removes exactly the chip selected in the composer, including a preview chip. */
export function removeAttachment(attachments: Attachment[], index: number): Attachment[] {
  return attachments.filter((_, currentIndex) => currentIndex !== index);
}
