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
  type AgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_DOCX_MAX_BYTES,
  DEFAULT_PDF_MAX_BYTES,
  DEFAULT_MAIL_MAX_BYTES,
  DEFAULT_PPTX_MAX_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
  DEFAULT_STRUCTURED_EXCHANGE_MAX_BYTES,
  DEFAULT_XLSX_MAX_BYTES,
  type SandboxConfig,
} from "./config.ts";
import { createDocxExtractToolDefinition } from "./docxTool.ts";
import { createXlsxExtractToolDefinition } from "./xlsxTool.ts";
import { createPptxExtractToolDefinition } from "./pptxTool.ts";
import { createMailExtractToolDefinition } from "./mailTool.ts";
import { createPdfExtractToolDefinition, createPdfRenderToolDefinition } from "./pdfTool.ts";
import {
  createPptxCreateToolDefinition,
  createPptxLayoutsToolDefinition,
  createPptxRenderToolDefinition,
  createPptxUpdateToolDefinition,
} from "./presentationTools.ts";
import {
  createDocxCreateToolDefinition,
  createDocxRenderToolDefinition,
  createDocxStylesToolDefinition,
  createDocxRestyleToolDefinition,
  createDocxUpdateToolDefinition,
} from "./wordTools.ts";
import type { RenderSettings } from "./presentationRender.ts";
import { createStructuredExchangeFigureToolDefinition } from "./structuredExchangeFigureTool.ts";
import { createTimelineComparisonToolDefinition } from "./timelineComparisonTool.ts";
import { createStructuredExchangeTableToolDefinition } from "./structuredExchangeTableTool.ts";

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
 * SECURITY: present `cwd` as the context's working directory for the duration
 * of one tool call.
 *
 * The built-in tools resolve a relative path against `ctx.cwd` in preference to
 * the `cwd` they were built with (`ctx?.cwd || cwd`, since pi-coding-agent
 * 0.85.0 — earendil-works/pi#8627). The session's `cwd` is the project root,
 * which is above the sandbox root, so without this the guard below would check
 * a path against one base while the tool acted on another: `outside/secret.txt`
 * resolves to `<root>/outside/secret.txt` — inside the sandbox, so admitted —
 * and is then read as `<project>/outside/secret.txt`, which is not.
 *
 * A Proxy rather than a spread: the context carries accessors and live session
 * state, and copying it would freeze what it reports.
 */
function withCwd<Context extends ExtensionContext>(ctx: Context, cwd: string): Context {
  if (!ctx) return ctx;
  return new Proxy(ctx, {
    get: (target, prop, receiver) => (prop === "cwd" ? cwd : Reflect.get(target, prop, receiver)),
  });
}

/**
 * Wrap `def` so every `path` argument — resolved relative to `cwd`, symlinks
 * included — must land inside `allowedRoot`. `cwd` is always the sandbox root
 * (paths the model sees are relative to it), and the call executes against that
 * same root, so the path checked is the path acted on; `allowedRoot` is the zone
 * this particular tool is confined to (the full root for read tools,
 * `writableRoot` for edit/write).
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
      return def.execute(toolCallId, params, signal, onUpdate, withCwd(ctx, cwd));
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
  xlsxMaxBytes: number = DEFAULT_XLSX_MAX_BYTES,
  pptxMaxBytes: number = DEFAULT_PPTX_MAX_BYTES,
  structuredExchangeMaxBytes: number = DEFAULT_STRUCTURED_EXCHANGE_MAX_BYTES,
  /**
   * The project whose structured-exchange profiles apply. The workspace always passes
   * its project directory; the default serves a sandbox rooted at the project, which
   * is what every caller that omits it builds.
   */
  projectRoot: string = sandbox.root,
  /** How `pptx_render` finds and runs an office application. */
  officeRender: RenderSettings = { renderer: "auto", timeoutMs: DEFAULT_RENDER_TIMEOUT_MS },
  mailMaxBytes: number = DEFAULT_MAIL_MAX_BYTES,
  /**
   * Called with the workspace paths of the documents `mail_extract` has just written.
   *
   * The session publishes the reader for each kind written, inside the turn that
   * wrote it (see documentToolsForWrittenPaths). It arrives here because a sandboxed
   * toolset is what a real deployment runs — leaving it to the unsandboxed branch
   * alone would mean an unpacked attachment the agent cannot open on every server
   * that configures a sandbox, which is the default in this project's own tests.
   */
  onDocumentsWritten?: (paths: string[]) => void,
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
  // The zone a document extraction may write into. Computed before the read tools
  // are built because they take it too — `null` when writes are disabled, which
  // makes every output_path a refusal rather than an unchecked write.
  let realWritableRoot: string | null = null;
  if (sandbox.allowWrite) {
    realWritableRoot = sandbox.writableRoot ? await fs.realpath(sandbox.writableRoot) : realRoot;
    if (!isWithin(realRoot, realWritableRoot)) {
      throw new Error(`sandbox.writableRoot (${realWritableRoot}) must be inside sandbox.root (${realRoot})`);
    }
  }

  // Reading a document is reading: same zone, same exceptions, never behind allowBash.
  // The read exceptions are NOT passed as a writable zone — they widen reading only,
  // so a skill directory outside the root stays unwritable, as it does for edit.
  const documentRoots = [realRoot, ...(readExceptions ?? [])];
  readFactories.push((cwd) =>
    createPdfExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: pdfMaxBytes, writableRoot: realWritableRoot }),
  );
  // Drawing a page is reading it too: it opens the file and returns pictures of it,
  // writing nothing. It belongs beside the extractor, not behind a wider permission.
  readFactories.push((cwd) =>
    createPdfRenderToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: pdfMaxBytes, writableRoot: realWritableRoot }),
  );
  readFactories.push((cwd) =>
    createDocxExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: docxMaxBytes, writableRoot: realWritableRoot }),
  );
  readFactories.push((cwd) =>
    createXlsxExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: xlsxMaxBytes, writableRoot: realWritableRoot }),
  );
  readFactories.push((cwd) =>
    createPptxExtractToolDefinition({ cwd, allowedRoots: documentRoots, maxBytes: pptxMaxBytes, writableRoot: realWritableRoot }),
  );
  // Reading a message is reading, so it sits with the extractors — and unpacking an
  // attachment is a write, measured against the writable zone exactly as an
  // `output_path` is.
  readFactories.push((cwd) =>
    createMailExtractToolDefinition({
      cwd,
      allowedRoots: documentRoots,
      maxBytes: mailMaxBytes,
      writableRoot: realWritableRoot,
      ...(onDocumentsWritten === undefined ? {} : { onDocumentsWritten }),
    }),
  );
  // Reading a document and drawing it is reading, so it sits with the extractors:
  // same zone, same exceptions, and its `output_path` measured against the writable
  // one exactly as theirs is.
  readFactories.push((cwd) =>
    createStructuredExchangeFigureToolDefinition({
      cwd,
      allowedRoots: documentRoots,
      maxBytes: structuredExchangeMaxBytes,
      writableRoot: realWritableRoot,
      projectRoot,
    }),
  );
  // Comparing two plans reads two documents and may write one: confined like the figure tool.
  readFactories.push((cwd) =>
    createTimelineComparisonToolDefinition({
      cwd,
      allowedRoots: documentRoots,
      maxBytes: structuredExchangeMaxBytes,
      writableRoot: realWritableRoot,
    }),
  );
  // Writing a table as Markdown reads a document and writes one file: the figure tool's twin.
  readFactories.push((cwd) =>
    createStructuredExchangeTableToolDefinition({
      cwd,
      allowedRoots: documentRoots,
      maxBytes: structuredExchangeMaxBytes,
      writableRoot: realWritableRoot,
      projectRoot,
    }),
  );
  // Reading a template and drawing a deck are reading too; the rendering's pdf_path is
  // measured against the writable zone like every other destination.
  const presentation = { allowedRoots: documentRoots, maxBytes: pptxMaxBytes, writableRoot: realWritableRoot, render: officeRender };
  readFactories.push((cwd) => createPptxLayoutsToolDefinition({ cwd, ...presentation }));
  readFactories.push((cwd) => createPptxRenderToolDefinition({ cwd, ...presentation }));
  // The same for Word documents: describing a template and drawing a document read.
  const word = { allowedRoots: documentRoots, maxBytes: docxMaxBytes, writableRoot: realWritableRoot, render: officeRender };
  readFactories.push((cwd) => createDocxStylesToolDefinition({ cwd, ...word }));
  readFactories.push((cwd) => createDocxRenderToolDefinition({ cwd, ...word }));
  const tools = readFactories.map((create) =>
    scopeToRoot(create(realRoot), realRoot, realRoot, readExceptions),
  );
  // Building a deck writes one: offered only where writing is.
  if (realWritableRoot !== null) {
    tools.push(scopeToRoot(createPptxCreateToolDefinition({ cwd: realRoot, ...presentation }), realRoot, realRoot, readExceptions));
    tools.push(scopeToRoot(createPptxUpdateToolDefinition({ cwd: realRoot, ...presentation }), realRoot, realRoot, readExceptions));
    // Writing, updating and restyling a Word document write one.
    tools.push(scopeToRoot(createDocxCreateToolDefinition({ cwd: realRoot, ...word }), realRoot, realRoot, readExceptions));
    tools.push(scopeToRoot(createDocxUpdateToolDefinition({ cwd: realRoot, ...word }), realRoot, realRoot, readExceptions));
    tools.push(scopeToRoot(createDocxRestyleToolDefinition({ cwd: realRoot, ...word }), realRoot, realRoot, readExceptions));
  }

  if (realWritableRoot !== null) {
    const writeFactories: Array<(cwd: string) => ToolDefinition> = [
      (cwd) => createEditToolDefinition(cwd) as ToolDefinition,
      (cwd) => createWriteToolDefinition(cwd) as ToolDefinition,
    ];
    tools.push(...writeFactories.map((create) => scopeToRoot(create(realRoot), realRoot, realWritableRoot)));
  }

  if (sandbox.allowBash) {
    // Explicit opt-in: bash runs in the root but is NOT path-confined. The root
    // still has to be pinned onto the context, or the shell starts in the
    // project root instead — see `withCwd`.
    const bash = createBashToolDefinition(realRoot) as ToolDefinition;
    tools.push({
      ...bash,
      execute: (toolCallId, params, signal, onUpdate, ctx) =>
        bash.execute(toolCallId, params, signal, onUpdate, withCwd(ctx, realRoot)),
    });
  }
  return tools;
}

/**
 * Pi's built-in tools, as `allToolNames` in its `core/tools` lists them.
 *
 * Not exported by the package, so named here; `assertNoUnconfinedBuiltIns` is what
 * notices when a Pi upgrade adds one.
 */
export const PI_BUILTIN_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];

/**
 * The built-ins a sandboxed session must not register: every one the sandbox does not
 * replace with its own confined tool of the same name.
 *
 * `noTools: "builtin"` alone only starts them inactive. They stay registered, and an
 * inactive tool is one `setActiveTools` away — a call every extension is handed — so
 * a sandbox without `allowBash` still carried Pi's unconfined `bash` and `powershell`,
 * and a read-only one its unconfined `write` and `edit`. Excluding a name drops it
 * from the registry altogether, whoever registered it.
 */
export function unsuppliedBuiltIns(sandboxedTools: ToolDefinition[]): string[] {
  const supplied = new Set(sandboxedTools.map((tool) => tool.name));
  return PI_BUILTIN_TOOL_NAMES.filter((name) => !supplied.has(name));
}

/**
 * Fail closed when a sandboxed session still registers one of Pi's own built-ins.
 *
 * Every tool of that name was either replaced by the sandbox (registered from the SDK)
 * or excluded, so one that remains is a built-in this list does not know about yet —
 * an unconfined tool an extension could switch on. Refusing the session is the only
 * answer that keeps the sandbox meaning what it says.
 */
export function assertNoUnconfinedBuiltIns(session: Pick<AgentSession, "getAllTools">): void {
  const leaked = session
    .getAllTools()
    .filter((tool) => tool.sourceInfo.source === "builtin")
    .map((tool) => tool.name);
  if (leaked.length > 0) {
    throw new Error(
      `Sandboxed session still registers Pi's unconfined built-in tools: ${leaked.join(", ")}. ` +
        "pi-outpost does not know how to withhold them; refusing to start the session.",
    );
  }
}
