/**
 * Rendering a deck with an office application, and reading what it drew.
 *
 * The applications themselves are not on CI, so the invocations are checked through
 * an injected runner — the argv, the environment, the order converters are tried in —
 * and the reading is checked on `fixtures/pptx-rendered.pdf`, a real LibreOffice
 * rendering of `fixtures/pptx-rendered.pptx` (see make-pptx-rendered.mts). Slide 3 of
 * that deck overflows: LibreOffice drew paragraphs 1–5 of 16.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { readSlideParagraphs } from "../src/pptx.ts";
import {
  convertPresentationToPdf,
  defaultRunner,
  findLibreOffice,
  findOnlyOffice,
  findUnreadableText,
  onlyOfficeScript,
  POWERPOINT_SCRIPT,
  rasterizePdf,
  rasterizeSvg,
  RenderError,
  renderersFor,
  type ProcessResult,
  type RenderEnvironment,
  type RenderSettings,
} from "../src/presentationRender.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const DECK = path.join(FIXTURES, "pptx-rendered.pptx");
const PDF = path.join(FIXTURES, "pptx-rendered.pdf");
const AUTO: RenderSettings = { renderer: "auto", timeoutMs: 5_000 };

interface Call {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** The deck handed to the converter, as it was when the converter ran. */
  inputExisted: boolean;
}

/**
 * A machine with the given executables, whose converters behave as `outcomes` says:
 * "ok" writes a PDF where that converter would, anything else fails with that text.
 */
function machine(options: {
  platform: NodeJS.Platform;
  files?: string[];
  env?: NodeJS.ProcessEnv;
  outcomes?: Partial<Record<"powerpoint" | "libreoffice" | "onlyoffice", "ok" | "timeout" | string>>;
}): { environment: RenderEnvironment; calls: Call[] } {
  const calls: Call[] = [];
  const files = new Set(options.files ?? []);
  const run = async (file: string, args: string[], runOptions: { env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ProcessResult> => {
    const kind = /powershell/i.test(file) ? "powerpoint" : /soffice|libreoffice/i.test(file) ? "libreoffice" : "onlyoffice";
    let output: string;
    let input: string;
    if (kind === "powerpoint") {
      output = runOptions.env.PI_OUTPOST_RENDER_OUTPUT!;
      input = runOptions.env.PI_OUTPOST_RENDER_INPUT!;
    } else if (kind === "libreoffice") {
      output = path.join(args[args.indexOf("--outdir") + 1], "deck.pdf");
      input = args[args.length - 1];
    } else {
      const script = await readFile(args[0], "utf8");
      output = JSON.parse(/SaveFile\("pdf", (".*")\);/.exec(script)![1]);
      input = JSON.parse(/OpenFile\((".*"), ""\);/.exec(script)![1]);
    }
    const inputExisted = await readFile(input).then(() => true, () => false);
    calls.push({ file, args, env: runOptions.env, inputExisted });
    const outcome = options.outcomes?.[kind] ?? "ok";
    if (outcome === "ok") {
      await copyFile(PDF, output);
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }
    if (outcome === "timeout") return { code: null, stdout: "", stderr: "", timedOut: true };
    return { code: 1, stdout: "", stderr: outcome, timedOut: false };
  };
  return {
    environment: { platform: options.platform, env: options.env ?? {}, run, isFile: async (file) => files.has(file) },
    calls,
  };
}

const WIN_ENV = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", SystemRoot: "C:\\Windows", PATH: "C:\\Windows\\System32" };
const WIN_SOFFICE_COM = "C:\\Program Files\\LibreOffice\\program\\soffice.com";
const WIN_SOFFICE_EXE = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
const WIN_DOCBUILDER = "C:\\Program Files\\ONLYOFFICE\\DocumentBuilder\\docbuilder.exe";

describe("choosing a converter", () => {
  test("auto tries PowerPoint first on Windows only; a named one is the only one tried", () => {
    assert.deepEqual(renderersFor("auto", "win32"), ["powerpoint", "libreoffice", "onlyoffice"]);
    assert.deepEqual(renderersFor("auto", "linux"), ["libreoffice", "onlyoffice"]);
    assert.deepEqual(renderersFor("auto", "darwin"), ["libreoffice", "onlyoffice"]);
    assert.deepEqual(renderersFor("onlyoffice", "win32"), ["onlyoffice"]);
  });

  test("finds LibreOffice where it installs, preferring the console front end on Windows", async () => {
    const both = machine({ platform: "win32", env: WIN_ENV, files: [WIN_SOFFICE_COM, WIN_SOFFICE_EXE] });
    assert.equal(await findLibreOffice(AUTO, both.environment), WIN_SOFFICE_COM);
    const exeOnly = machine({ platform: "win32", env: WIN_ENV, files: [WIN_SOFFICE_EXE] });
    assert.equal(await findLibreOffice(AUTO, exeOnly.environment), WIN_SOFFICE_EXE);
    const onPath = machine({ platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, files: ["/usr/bin/soffice"] });
    assert.equal(await findLibreOffice(AUTO, onPath.environment), "/usr/bin/soffice");
    const mac = machine({ platform: "darwin", env: { PATH: "/usr/bin" }, files: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"] });
    assert.equal(await findLibreOffice(AUTO, mac.environment), "/Applications/LibreOffice.app/Contents/MacOS/soffice");
    assert.equal(await findLibreOffice(AUTO, machine({ platform: "linux", env: { PATH: "/usr/bin" } }).environment), undefined);
  });

  test("a configured executable wins, and a missing one is not replaced by a guess", async () => {
    const both = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice", "/opt/lo/soffice"] });
    assert.equal(await findLibreOffice({ ...AUTO, libreofficePath: "/opt/lo/soffice" }, both.environment), "/opt/lo/soffice");
    assert.equal(await findLibreOffice({ ...AUTO, libreofficePath: "/opt/missing/soffice" }, both.environment), undefined);
  });

  test("finds ONLYOFFICE Document Builder where it installs", async () => {
    assert.equal(await findOnlyOffice(AUTO, machine({ platform: "win32", env: WIN_ENV, files: [WIN_DOCBUILDER] }).environment), WIN_DOCBUILDER);
    assert.equal(
      await findOnlyOffice(AUTO, machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/opt/onlyoffice/documentbuilder/docbuilder"] }).environment),
      "/opt/onlyoffice/documentbuilder/docbuilder",
    );
    assert.equal(await findOnlyOffice(AUTO, machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/documentbuilder"] }).environment), "/usr/bin/documentbuilder");
  });
});

describe("converting to PDF", () => {
  test("drives PowerPoint through PowerShell, with the paths in the environment rather than the script", async () => {
    const { environment, calls } = machine({ platform: "win32", env: WIN_ENV });
    const result = await convertPresentationToPdf(DECK, AUTO, environment);
    assert.equal(result.renderer, "powerpoint");
    assert.ok(result.pdf.equals(await readFile(PDF)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    assert.deepEqual(calls[0].args, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERPOINT_SCRIPT]);
    // The converter reads a private copy, never the user's file.
    assert.equal(path.basename(calls[0].env.PI_OUTPOST_RENDER_INPUT!), "deck.pptx");
    assert.notEqual(calls[0].env.PI_OUTPOST_RENDER_INPUT, DECK);
    assert.ok(calls[0].inputExisted);
    assert.ok(!POWERPOINT_SCRIPT.includes(DECK));
  });

  test("the PowerPoint script opens read-only and windowless, saves as PDF, and never closes the user's decks", () => {
    assert.match(POWERPOINT_SCRIPT, /Presentations\.Open\(\$env:PI_OUTPOST_RENDER_INPUT, -1, 0, 0\)/);
    assert.match(POWERPOINT_SCRIPT, /\.SaveAs\(\$env:PI_OUTPOST_RENDER_OUTPUT, 32\)/);
    assert.match(POWERPOINT_SCRIPT, /if \(\$app -ne \$null -and \$app\.Presentations\.Count -eq 0\) \{ \$app\.Quit\(\) \}/);
    assert.doesNotMatch(POWERPOINT_SCRIPT, /Visible/);
  });

  test("falls back to LibreOffice when PowerPoint cannot run, and says why it skipped it", async () => {
    const { environment, calls } = machine({
      platform: "win32",
      env: WIN_ENV,
      files: [WIN_SOFFICE_COM],
      outcomes: { powerpoint: "Retrieving the COM class factory for component failed" },
    });
    const result = await convertPresentationToPdf(DECK, AUTO, environment);
    assert.equal(result.renderer, "libreoffice");
    assert.deepEqual(result.skipped, [{ renderer: "powerpoint", failure: "Retrieving the COM class factory for component failed" }]);
    assert.equal(calls[1].file, WIN_SOFFICE_COM);
    // Windows keeps its own display back end; SAL_USE_VCLPLUGIN is a Unix setting.
    assert.equal(calls[1].env.SAL_USE_VCLPLUGIN, undefined);
  });

  test("runs LibreOffice headless, with a private profile, converting the copy into its own folder", async () => {
    const { environment, calls } = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"] });
    const result = await convertPresentationToPdf(DECK, AUTO, environment);
    assert.equal(result.renderer, "libreoffice");
    const args = calls[0].args;
    const input = args[args.length - 1];
    const workDir = path.dirname(input);
    assert.equal(path.basename(input), "deck.pptx");
    assert.deepEqual(args.slice(1, -1), ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", workDir]);
    assert.match(args[0], /^-env:UserInstallation=file:\/\//);
    assert.ok(fileURLToPath(args[0].slice("-env:UserInstallation=".length)).startsWith(workDir));
    assert.equal(calls[0].env.SAL_USE_VCLPLUGIN, "svp");
  });

  test("runs ONLYOFFICE Document Builder on a script naming the copy and the PDF", async () => {
    const { environment, calls } = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/docbuilder"] });
    const result = await convertPresentationToPdf(DECK, { ...AUTO, renderer: "onlyoffice" }, environment);
    assert.equal(result.renderer, "onlyoffice");
    assert.equal(calls[0].file, "/usr/bin/docbuilder");
    assert.equal(calls[0].args.length, 1);
    assert.equal(path.basename(calls[0].args[0]), "render.docbuilder");
  });

  test("writes paths into the Document Builder script as string literals, whatever they contain", () => {
    const script = onlyOfficeScript('C:\\Users\\a "b"\\deck.pptx', "C:\\out\\deck.pdf");
    assert.equal(
      script,
      'builder.OpenFile("C:\\\\Users\\\\a \\"b\\"\\\\deck.pptx", "");\nbuilder.SaveFile("pdf", "C:\\\\out\\\\deck.pdf");\nbuilder.CloseFile();\n',
    );
  });

  test("when nothing can render, says what was tried and what to install", async () => {
    const { environment } = machine({ platform: "win32", env: WIN_ENV, outcomes: { powerpoint: "PowerPoint is not installed" } });
    await assert.rejects(
      () => convertPresentationToPdf(DECK, AUTO, environment),
      (error: unknown) =>
        error instanceof RenderError &&
        /- powerpoint: PowerPoint is not installed/.test(error.message) &&
        /- libreoffice: LibreOffice is not installed \(no soffice found\)/.test(error.message) &&
        /- onlyoffice: ONLYOFFICE Document Builder is not installed/.test(error.message) &&
        /Install LibreOffice/.test(error.message),
    );
  });

  test("a named renderer is not replaced by another, and PowerPoint is refused off Windows", async () => {
    const { environment, calls } = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"] });
    await assert.rejects(() => convertPresentationToPdf(DECK, { ...AUTO, renderer: "powerpoint" }, environment), /only available on Windows/);
    assert.equal(calls.length, 0);
  });

  test("gives up on a converter that does not finish, and names the time it had", async () => {
    const { environment } = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"], outcomes: { libreoffice: "timeout" } });
    await assert.rejects(() => convertPresentationToPdf(DECK, { ...AUTO, renderer: "libreoffice" }, environment), /did not finish within 5 s/);
  });

  test("leaves no working directory behind, whether the conversion succeeds or fails", async () => {
    // The directory the converter was handed, not a count of the shared tmpdir: other test
    // files render in parallel and would make a count flaky.
    const succeeded = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"] });
    await convertPresentationToPdf(DECK, AUTO, succeeded.environment);
    const failed = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"], outcomes: { libreoffice: "crashed" } });
    await assert.rejects(() => convertPresentationToPdf(DECK, { ...AUTO, renderer: "libreoffice" }, failed.environment), /crashed/);
    for (const call of [succeeded.calls[0], failed.calls[0]]) {
      const workDir = path.dirname(call.args[call.args.length - 1]);
      assert.ok(path.basename(workDir).startsWith("pi-outpost-render-"));
      assert.ok(!existsSync(workDir), `${workDir} was removed`);
    }
  });
});

describe("stopping a rendering", () => {
  test("hands the turn's signal to the converter, and starts no other converter once stopped", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const environment: RenderEnvironment = {
      platform: "win32",
      env: WIN_ENV,
      isFile: async (file) => file === WIN_SOFFICE_COM,
      run: async (_file, _args, options) => {
        seen.push(options.signal);
        // The user stops the agent while PowerPoint is converting.
        controller.abort();
        return { code: null, stdout: "", stderr: "", timedOut: true };
      },
    };
    await assert.rejects(() => convertPresentationToPdf(DECK, AUTO, environment, controller.signal), /The rendering was stopped\./);
    assert.deepEqual(seen, [controller.signal], "LibreOffice was not started after the stop");
  });

  test("a signal already stopped starts nothing", async () => {
    const { environment, calls } = machine({ platform: "linux", env: { PATH: "/usr/bin" }, files: ["/usr/bin/soffice"] });
    await assert.rejects(() => convertPresentationToPdf(DECK, AUTO, environment, AbortSignal.abort()), /stopped/);
    assert.equal(calls.length, 0);
  });
});

describe("the default runner", () => {
  test("reports the exit code, the output and a timeout", async () => {
    const ok = await defaultRunner(process.execPath, ["-e", "process.stdout.write('hi')"], { env: process.env, timeoutMs: 20_000 });
    assert.deepEqual([ok.code, ok.stdout, ok.timedOut], [0, "hi", false]);
    const failed = await defaultRunner(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(3)"], { env: process.env, timeoutMs: 20_000 });
    assert.deepEqual([failed.code, failed.stderr, failed.timedOut], [3, "bad", false]);
    const slow = await defaultRunner(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { env: process.env, timeoutMs: 300 });
    assert.equal(slow.timedOut, true);
    // Stopping the turn kills the process rather than waiting out its timeout.
    const started = Date.now();
    const stopped = await defaultRunner(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], {
      env: process.env,
      timeoutMs: 20_000,
      signal: AbortSignal.timeout(300),
    });
    assert.notEqual(stopped.code, 0);
    assert.ok(Date.now() - started < 10_000, "killed on the signal, not after 20 s");
  });
});

describe("reading what was drawn", () => {
  test("reports the paragraphs that ran off a slide, and only those", async () => {
    const expected = readSlideParagraphs(await readFile(DECK));
    assert.equal(expected.length, 4);
    const findings = await findUnreadableText(await readFile(PDF), expected, [1, 2, 3, 4]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].slide, 3);
    assert.deepEqual(
      findings[0].missing,
      Array.from({ length: 11 }, (_, i) => `Paragraph ${i + 6} is long enough to wrap onto a second line of the box`),
    );
  });

  test("checks only the slides asked for", async () => {
    const expected = readSlideParagraphs(await readFile(DECK));
    assert.deepEqual(await findUnreadableText(await readFile(PDF), expected, [1, 2, 4]), []);
  });

  test("flags a paragraph the page does not show at all", async () => {
    const expected = readSlideParagraphs(await readFile(DECK));
    expected[1] = [...expected[1], "A sentence that is nowhere on the page"];
    const findings = await findUnreadableText(await readFile(PDF), expected, [2]);
    assert.deepEqual(findings, [{ slide: 2, missing: ["A sentence that is nowhere on the page"], atEdge: false }]);
  });

  test("draws the requested pages as PNGs of the requested width", async () => {
    const raster = await rasterizePdf(await readFile(PDF), [2, 9], 640);
    assert.ok(raster !== null, "@napi-rs/canvas is installed with the server's dependencies");
    assert.equal(raster.pageCount, 4);
    // Page 9 does not exist and is skipped rather than failing the call.
    assert.deepEqual(raster.images.map((image) => [image.page, image.width, image.height]), [[2, 640, 360]]);
    const png = raster.images[0].png;
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(png.readUInt32BE(16), 640);
  });

  test("draws an SVG to a PNG of the requested size", async () => {
    const png = await rasterizeSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1" fill="red"/></svg>'), 200, 100);
    assert.ok(png !== null);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [200, 100]);
    assert.equal(await rasterizeSvg(Buffer.from("not an svg"), 10, 10), null);
  });
});
