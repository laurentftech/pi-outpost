/**
 * Rendering a presentation the way an office suite draws it, so the agent can look
 * at what it built.
 *
 * Writing a slide is not seeing it: a title that wraps to three lines, bullets that
 * run off the bottom, a picture drawn over the text — none of it is visible in the
 * markup. The deck is converted to PDF by a real office application and the pages are
 * rasterised here, so the model receives pictures of its slides and can fix what it
 * sees before handing the file over.
 *
 * Three converters, tried in this order when the choice is `auto`:
 *
 * - **PowerPoint**, on Windows, through COM automation from PowerShell. The reference
 *   rendering: it is what the audience will open the file with.
 * - **LibreOffice** (`soffice --headless --convert-to pdf`), on every platform.
 * - **ONLYOFFICE Document Builder** (`docbuilder`), running a three-line script.
 *
 * SECURITY: nothing here takes a command line from the model. The executables are
 * found in configured or conventional places, the paths travel as separate argv
 * entries or environment variables (never spliced into a shell or a PowerShell
 * string), and the input is a copy under a private temporary directory, so the
 * converter never writes next to the user's files.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadPdfjs, pdfjsAssetDirs } from "./pdf.ts";

import type { RendererChoice } from "./config.ts";

export type { RendererChoice } from "./config.ts";
export { DEFAULT_RENDER_TIMEOUT_MS } from "./config.ts";
export type RendererName = Exclude<RendererChoice, "auto">;
export const RENDERER_NAMES: RendererName[] = ["powerpoint", "libreoffice", "onlyoffice"];

export interface RenderSettings {
  renderer: RendererChoice;
  /** An explicit `soffice` executable; conventional locations are searched otherwise. */
  libreofficePath?: string;
  /** An explicit `docbuilder` executable; conventional locations are searched otherwise. */
  onlyofficePath?: string;
  timeoutMs: number;
}


export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs one executable with an argv array — never through a shell. Injectable for tests. */
export type ProcessRunner = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
) => Promise<ProcessResult>;

export interface RenderEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  run: ProcessRunner;
  /** Whether an executable exists at this path. */
  isFile: (file: string) => Promise<boolean>;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export const defaultRunner: ProcessRunner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      // The signal is the turn's: a user who stops the agent must not leave an office
      // application converting in the background for minutes.
      { env: options.env, timeout: options.timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        resolve({
          code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? "") || (failure !== null && typeof failure.code === "string" ? `${failure.code}: ${failure.message}` : ""),
          timedOut: failure?.killed === true,
        });
      },
    );
  });

export function defaultEnvironment(): RenderEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    run: defaultRunner,
    isFile: async (file) => {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) return false;
        if (process.platform !== "win32") await fs.access(file, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* ── Finding the converters ─────────────────────────────────────────────────── */

/** Path helpers for the platform being described, so Windows rules apply on Windows. */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** `name` along PATH, with the Windows executable extensions tried. */
async function onPath(names: string[], environment: RenderEnvironment): Promise<string | undefined> {
  const p = pathFor(environment.platform);
  const pathValue = environment.env.PATH ?? environment.env.Path ?? "";
  const directories = pathValue.split(environment.platform === "win32" ? ";" : ":").filter(Boolean);
  const suffixes = environment.platform === "win32" ? [".exe", ".com"] : [""];
  for (const directory of directories) {
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidate = p.join(directory, name + suffix);
        if (await environment.isFile(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

async function firstExisting(candidates: string[], environment: RenderEnvironment): Promise<string | undefined> {
  for (const candidate of candidates) if (await environment.isFile(candidate)) return candidate;
  return undefined;
}

function programFilesDirs(environment: RenderEnvironment): string[] {
  const dirs = [environment.env.ProgramFiles, environment.env["ProgramFiles(x86)"], environment.env.ProgramW6432];
  return [...new Set(dirs.filter((dir): dir is string => typeof dir === "string" && dir !== ""))];
}

/**
 * Where LibreOffice lives. On Windows `soffice.com` comes first: it is the console
 * front end that waits for the conversion, where `soffice.exe` may return before
 * the PDF is written.
 */
export async function findLibreOffice(settings: RenderSettings, environment: RenderEnvironment): Promise<string | undefined> {
  if (settings.libreofficePath) return (await environment.isFile(settings.libreofficePath)) ? settings.libreofficePath : undefined;
  const p = pathFor(environment.platform);
  if (environment.platform === "win32") {
    const installed = programFilesDirs(environment).flatMap((dir) => [
      p.join(dir, "LibreOffice", "program", "soffice.com"),
      p.join(dir, "LibreOffice", "program", "soffice.exe"),
    ]);
    return (await firstExisting(installed, environment)) ?? (await onPath(["soffice"], environment));
  }
  if (environment.platform === "darwin") {
    const bundled = await firstExisting(["/Applications/LibreOffice.app/Contents/MacOS/soffice"], environment);
    if (bundled) return bundled;
  }
  return onPath(["soffice", "libreoffice"], environment);
}

export async function findOnlyOffice(settings: RenderSettings, environment: RenderEnvironment): Promise<string | undefined> {
  if (settings.onlyofficePath) return (await environment.isFile(settings.onlyofficePath)) ? settings.onlyofficePath : undefined;
  const p = pathFor(environment.platform);
  if (environment.platform === "win32") {
    const installed = programFilesDirs(environment).map((dir) => p.join(dir, "ONLYOFFICE", "DocumentBuilder", "docbuilder.exe"));
    return (await firstExisting(installed, environment)) ?? (await onPath(["docbuilder"], environment));
  }
  const installed = await firstExisting(["/opt/onlyoffice/documentbuilder/docbuilder"], environment);
  return installed ?? (await onPath(["documentbuilder", "docbuilder"], environment));
}

/* ── Converting to PDF ──────────────────────────────────────────────────────── */

/**
 * The PowerPoint conversion, as PowerShell. Paths arrive in environment variables, so
 * no file name is ever parsed as script.
 *
 * - `Presentations.Open(file, ReadOnly, Untitled, WithWindow)` takes MsoTriState
 *   values: -1 is msoTrue, 0 is msoFalse. `WithWindow` false keeps the deck out of
 *   sight; setting `Application.Visible` to false is refused by PowerPoint itself.
 * - `SaveAs(path, 32)`: 32 is ppSaveAsPDF.
 * - PowerPoint is a single instance shared with the user. It is only told to quit if
 *   nothing else is open in it — otherwise the user's own presentations would close.
 */
export const POWERPOINT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$app = $null; $deck = $null",
  "try {",
  "  $app = New-Object -ComObject PowerPoint.Application",
  "  $deck = $app.Presentations.Open($env:PI_OUTPOST_RENDER_INPUT, -1, 0, 0)",
  "  $deck.SaveAs($env:PI_OUTPOST_RENDER_OUTPUT, 32)",
  "} finally {",
  "  if ($deck -ne $null) { $deck.Close() }",
  "  if ($app -ne $null -and $app.Presentations.Count -eq 0) { $app.Quit() }",
  "}",
].join("\n");

/** The Document Builder script: open, save as PDF, close. Paths are JSON string literals. */
export function onlyOfficeScript(input: string, output: string): string {
  return [`builder.OpenFile(${JSON.stringify(input)}, "");`, `builder.SaveFile("pdf", ${JSON.stringify(output)});`, "builder.CloseFile();", ""].join("\n");
}

interface Attempt {
  renderer: RendererName;
  failure: string;
}

function describeFailure(result: ProcessResult, timeoutMs: number): string {
  if (result.timedOut) return `did not finish within ${Math.round(timeoutMs / 1000)} s`;
  const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
  return detail !== "" ? detail : `exited with code ${result.code ?? "unknown"}`;
}

async function hasOutput(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function convertWith(
  renderer: RendererName,
  input: string,
  workDir: string,
  settings: RenderSettings,
  environment: RenderEnvironment,
  signal: AbortSignal | undefined,
): Promise<{ pdf: string } | { failure: string }> {
  const output = path.join(workDir, "deck.pdf");
  if (renderer === "powerpoint") {
    if (environment.platform !== "win32") return { failure: "PowerPoint automation is only available on Windows" };
    const powershell = environment.env.SystemRoot
      ? path.win32.join(environment.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const result = await environment.run(
      powershell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERPOINT_SCRIPT],
      {
        env: { ...environment.env, PI_OUTPOST_RENDER_INPUT: input, PI_OUTPOST_RENDER_OUTPUT: output },
        timeoutMs: settings.timeoutMs,
        signal,
      },
    );
    if (result.code === 0 && (await hasOutput(output))) return { pdf: output };
    return { failure: describeFailure(result, settings.timeoutMs) };
  }

  if (renderer === "libreoffice") {
    const soffice = await findLibreOffice(settings, environment);
    if (soffice === undefined) {
      return { failure: settings.libreofficePath ? `no executable at ${settings.libreofficePath}` : "LibreOffice is not installed (no soffice found)" };
    }
    // A private profile: a user's running LibreOffice otherwise swallows the request,
    // and a profile that cannot be created aborts the conversion outright.
    const profile = pathToFileURL(path.join(workDir, "profile")).href;
    const result = await environment.run(
      soffice,
      [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", workDir, input],
      {
        env: environment.platform === "win32" ? environment.env : { ...environment.env, SAL_USE_VCLPLUGIN: "svp" },
        timeoutMs: settings.timeoutMs,
        signal,
      },
    );
    if (await hasOutput(output)) return { pdf: output };
    return { failure: describeFailure(result, settings.timeoutMs) };
  }

  const docbuilder = await findOnlyOffice(settings, environment);
  if (docbuilder === undefined) {
    return { failure: settings.onlyofficePath ? `no executable at ${settings.onlyofficePath}` : "ONLYOFFICE Document Builder is not installed (no docbuilder found)" };
  }
  const script = path.join(workDir, "render.docbuilder");
  await fs.writeFile(script, onlyOfficeScript(input, output), "utf8");
  const result = await environment.run(docbuilder, [script], { env: environment.env, timeoutMs: settings.timeoutMs, signal });
  if (await hasOutput(output)) return { pdf: output };
  return { failure: describeFailure(result, settings.timeoutMs) };
}

/** The converters worth trying for a choice, in order. */
export function renderersFor(choice: RendererChoice, platform: NodeJS.Platform): RendererName[] {
  if (choice !== "auto") return [choice];
  return platform === "win32" ? ["powerpoint", "libreoffice", "onlyoffice"] : ["libreoffice", "onlyoffice"];
}

export interface PdfConversion {
  pdf: Buffer;
  renderer: RendererName;
  /** Converters tried before this one, and why each failed. */
  skipped: Attempt[];
}

/**
 * The presentation as a PDF drawn by an office application.
 *
 * The deck is copied into a private temporary directory as `deck.pptx` first: the
 * converters name their output after their input and write it beside them, and
 * neither belongs in the user's folder.
 */
export async function convertPresentationToPdf(
  source: string,
  settings: RenderSettings,
  environment: RenderEnvironment = defaultEnvironment(),
  signal?: AbortSignal,
): Promise<PdfConversion> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-render-"));
  try {
    const input = path.join(workDir, "deck.pptx");
    await fs.copyFile(source, input);
    const attempts: Attempt[] = [];
    for (const renderer of renderersFor(settings.renderer, environment.platform)) {
      // Stopped: neither this converter nor the next one is started.
      if (signal?.aborted) throw new RenderError("The rendering was stopped.");
      const outcome = await convertWith(renderer, input, workDir, settings, environment, signal);
      if ("pdf" in outcome) return { pdf: await fs.readFile(outcome.pdf), renderer, skipped: attempts };
      attempts.push({ renderer, failure: outcome.failure });
    }
    throw new RenderError(
      [
        "No office application could render the presentation:",
        ...attempts.map((attempt) => `- ${attempt.renderer}: ${attempt.failure}`),
        "Install LibreOffice (or, on Windows, PowerPoint; or ONLYOFFICE Document Builder), " +
          'or point "pptx.libreofficePath" / "pptx.onlyofficePath" in the configuration at one.',
      ].join("\n"),
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Rasterising ────────────────────────────────────────────────────────────── */

interface NativeCanvas {
  getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; drawImage(...args: unknown[]): void };
  encode(format: "png"): Promise<Buffer>;
}

interface CanvasModule {
  createCanvas(width: number, height: number): NativeCanvas;
  loadImage(source: Buffer): Promise<{ width: number; height: number }>;
}

/**
 * `@napi-rs/canvas`, when this install has it. It is optional — absent from the
 * single-file build and from installs that skip optional dependencies — so every
 * caller has an answer for `null`.
 */
export function loadCanvas(): CanvasModule | null {
  try {
    return createRequire(import.meta.url)("@napi-rs/canvas") as CanvasModule;
  } catch {
    return null;
  }
}

/**
 * An SVG drawn to a PNG of the given size, or `null` without a canvas.
 *
 * SECURITY: the SVG is handed over as bytes. `loadImage` also accepts a string —
 * which it treats as a file path or a URL — so a string must never reach it.
 */
export async function rasterizeSvg(svg: Buffer, width: number, height: number): Promise<Buffer | null> {
  const canvasModule = loadCanvas();
  if (canvasModule === null) return null;
  try {
    const image = await canvasModule.loadImage(Buffer.from(svg));
    const canvas = canvasModule.createCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return await canvas.encode("png");
  } catch {
    return null;
  }
}

export interface RenderedPage {
  page: number;
  png: Buffer;
  width: number;
  height: number;
}

interface RenderablePage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvas: unknown; viewport: unknown }): { promise: Promise<void> };
}

/**
 * Pages of a PDF as PNGs `width` pixels wide, or `null` when this install has no
 * canvas to draw on. Pages outside the document are skipped.
 */
export async function rasterizePdf(pdf: Buffer, pages: number[], width: number): Promise<{ pageCount: number; images: RenderedPage[] } | null> {
  const canvasModule = loadCanvas();
  if (canvasModule === null) return null;
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    ...pdfjsAssetDirs(),
    cMapPacked: true,
  });
  try {
    const doc = await task.promise;
    const images: RenderedPage[] = [];
    for (const number of pages) {
      if (number < 1 || number > doc.numPages) continue;
      const page = (await doc.getPage(number)) as unknown as RenderablePage;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / natural.width });
      const canvas = canvasModule.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
      images.push({ page: number, png: await canvas.encode("png"), width: Math.round(viewport.width), height: Math.round(viewport.height) });
    }
    return { pageCount: doc.numPages, images };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** How many pages the PDF has, without drawing any — for when there is no canvas. */
export async function countPdfPages(pdf: Buffer): Promise<number> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useWorkerFetch: false, useSystemFonts: false, disableAutoFetch: true, ...pdfjsAssetDirs() });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

/* ── Checking what was drawn ────────────────────────────────────────────────── */

export interface SlideFinding {
  slide: number;
  /** Paragraphs the slide holds that the rendered page does not show in full. */
  missing: string[];
  /** Text drawn within a hair of the page's edge — usually a box that overflowed. */
  atEdge: boolean;
}

interface TextItem {
  str?: string;
  width?: number;
  transform?: number[];
}

/** Letters and digits only: line wrapping, hyphen-free spacing and bullet glyphs do not count. */
function comparable(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s •▪◦‣∙·–—-]+/g, "");
}

/**
 * Compare each slide's paragraphs with the text an office application drew on the
 * matching page.
 *
 * Text that runs past the bottom of a slide is clipped out of the PDF entirely, so a
 * paragraph the slide holds but the page does not is text the audience will not see.
 * The comparison ignores whitespace and bullet glyphs, because the renderer wraps
 * lines and draws bullets in its own way; what is left has to match.
 */
export async function findUnreadableText(pdf: Buffer, expected: string[][], slides: number[]): Promise<SlideFinding[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useWorkerFetch: false, useSystemFonts: false, disableAutoFetch: true, ...pdfjsAssetDirs() });
  try {
    const doc = await task.promise;
    const findings: SlideFinding[] = [];
    for (const slide of slides) {
      if (slide < 1 || slide > doc.numPages) continue;
      const page = await doc.getPage(slide);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let drawn = "";
      let atEdge = false;
      for (const raw of content.items as TextItem[]) {
        if (typeof raw.str !== "string" || raw.str.trim() === "" || !Array.isArray(raw.transform)) continue;
        drawn += raw.str;
        const x = raw.transform[4];
        const y = raw.transform[5];
        const right = x + (typeof raw.width === "number" ? raw.width : 0);
        // PDF space: y grows upwards from the bottom of the page.
        if (y < viewport.height * 0.015 || right > viewport.width * 0.99 || x < 0) atEdge = true;
      }
      const shown = comparable(drawn);
      const missing = (expected[slide - 1] ?? []).filter((paragraph) => {
        const wanted = comparable(paragraph);
        return wanted !== "" && !shown.includes(wanted);
      });
      if (missing.length > 0 || atEdge) findings.push({ slide, missing, atEdge });
    }
    return findings;
  } finally {
    await task.destroy().catch(() => {});
  }
}
