/**
 * File-scoped tool sandbox.
 *
 * SECURITY: wraps the built-in file tools so every `path` argument must
 * resolve — symlinks included — inside the relevant zone. Read tools
 * (read/ls/grep/find) are confined to the whole sandbox root (the read-only
 * zone); edit/write, if enabled, are further confined to `writableRoot` (the
 * read-write zone, defaulting to the whole root). Bash is excluded unless
 * explicitly allowed in the config, because a shell cannot be path-scoped.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_DOCX_MAX_BYTES, DEFAULT_PDF_MAX_BYTES, type SandboxConfig } from "./config.ts";
import { createDocxExtractToolDefinition } from "./docxTool.ts";
import { createPdfExtractToolDefinition } from "./pdfTool.ts";

/**
 * Resolve `target` following symlinks in its deepest existing ancestor, so a
 * link pointing outside the root cannot smuggle paths in (or out) of the
 * sandbox. Non-existent tails (e.g. a file about to be written) are kept as-is.
 */
export async function realResolve(target: string): Promise<string> {
  let existing = target;
  let tail = "";
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return tail ? path.join(real, tail) : real;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target; // reached fs root, nothing exists
      tail = tail ? path.join(path.basename(existing), tail) : path.basename(existing);
      existing = parent;
    }
  }
}

export function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Check whether `target` lies inside at least one of the given `roots`.
 * Returns true if any root contains the target.
 */
export function isWithinAny(roots: string[], target: string): boolean {
  return roots.some((root) => isWithin(root, target));
}

/**
 * Wrap `def` so every `path` argument — resolved relative to `cwd`, symlinks
 * included — must land inside `allowedRoot`. `cwd` is always the sandbox root
 * (paths the model sees are relative to it); `allowedRoot` is the zone this
 * particular tool is confined to (the full root for read tools, `writableRoot`
 * for edit/write).
 *
 * When `readExceptions` is provided, read tools additionally allow paths
 * inside any of those directories — useful for skill/prompt directories
 * that live outside the sandbox root.
 */
function scopeToRoot(
  def: ToolDefinition,
  cwd: string,
  allowedRoot: string,
  readExceptions?: string[],
): ToolDefinition {
  return {
    ...def,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const target = (params as { path?: unknown }).path;
      if (typeof target === "string" && target !== "") {
        const resolved = await realResolve(path.resolve(cwd, target));
        const inAllowed = isWithin(allowedRoot, resolved);
        const inException = readExceptions && isWithinAny(readExceptions, resolved);
        if (!inAllowed && !inException) {
          throw new Error(`Access denied: "${target}" is outside the sandbox (${allowedRoot})`);
        }
      }
      return def.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

/**
 * Build the sandboxed replacement toolset. Use with `noTools: "builtin"` so
 * these are the only file tools the model sees.
 */
export async function createSandboxedTools(
  sandbox: SandboxConfig,
  pdfMaxBytes: number = DEFAULT_PDF_MAX_BYTES,
  docxMaxBytes: number = DEFAULT_DOCX_MAX_BYTES,
): Promise<ToolDefinition[]> {
  const realRoot = await fs.realpath(sandbox.root);
  const readFactories: Array<(cwd: string) => ToolDefinition> = [
    (cwd) => createReadToolDefinition(cwd) as ToolDefinition,
    (cwd) => createLsToolDefinition(cwd) as ToolDefinition,
    (cwd) => createGrepToolDefinition(cwd) as ToolDefinition,
    (cwd) => createFindToolDefinition(cwd) as ToolDefinition,
  ];
  const readExceptions: string[] | undefined =
    sandbox.readExceptions.length > 0
      ? await Promise.all(sandbox.readExceptions.map((p) => fs.realpath(p).catch(() => p)))
      : undefined;
  // Reading a document is reading: same zone, same exceptions, never behind allowBash.
  const documentRoots = [realRoot, ...(readExceptions ?? [])];
  readFactories.push((cwd) =>
    createPdfExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: pdfMaxBytes }),
  );
  readFactories.push((cwd) =>
    createDocxExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: docxMaxBytes }),
  );
  const tools = readFactories.map((create) =>
    scopeToRoot(create(realRoot), realRoot, realRoot, readExceptions),
  );

  if (sandbox.allowWrite) {
    const realWritableRoot = sandbox.writableRoot ? await fs.realpath(sandbox.writableRoot) : realRoot;
    if (!isWithin(realRoot, realWritableRoot)) {
      throw new Error(`sandbox.writableRoot (${realWritableRoot}) must be inside sandbox.root (${realRoot})`);
    }
    const writeFactories: Array<(cwd: string) => ToolDefinition> = [
      (cwd) => createEditToolDefinition(cwd) as ToolDefinition,
      (cwd) => createWriteToolDefinition(cwd) as ToolDefinition,
    ];
    tools.push(...writeFactories.map((create) => scopeToRoot(create(realRoot), realRoot, realWritableRoot)));
  }

  if (sandbox.allowBash) {
    // Explicit opt-in: bash runs in the root but is NOT path-confined
    tools.push(createBashToolDefinition(realRoot) as ToolDefinition);
  }
  return tools;
}
