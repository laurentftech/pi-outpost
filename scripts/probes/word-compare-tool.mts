/**
 * docx_compare against the real Microsoft Word, scenario by scenario. Windows with
 * desktop Word only; run `word-compare.ps1` first, which writes the two versions.
 *
 *   powershell -File scripts/probes/word-compare.ps1 -OutDir <dir>
 *   node --import tsx/esm scripts/probes/word-compare-tool.mts <dir>
 *
 * Each scenario prints what happened; the change's scenario-coverage.md records it.
 */
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createDocxCompareToolDefinition } from "../../server/src/docxCompare.ts";
import { defaultEnvironment, type RenderEnvironment } from "../../server/src/presentationRender.ts";
import { realResolve } from "../../server/src/sandbox.ts";

const run = promisify(execFile);
const versions = process.argv[2];
if (!versions) throw new Error("usage: word-compare-tool.mts <dir holding original.docx and revised.docx>");

const root = await realResolve(await mkdtemp(path.join(os.tmpdir(), "pi-outpost-compare-tool-")));
await mkdir(path.join(root, "v"));
await copyFile(path.join(versions, "original.docx"), path.join(root, "v", "spec-v1.docx"));
await copyFile(path.join(versions, "revised.docx"), path.join(root, "v", "spec-v2.docx"));

async function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env } });
  return stdout.trim();
}
const wordProcesses = async () => (await powershell("@(Get-Process WINWORD -ErrorAction SilentlyContinue).Count")).trim();

// A version that differs from the original only by one word made bold.
await copyFile(path.join(root, "v", "spec-v1.docx"), path.join(root, "v", "spec-v1-bold.docx"));
await powershell(
  [
    "$app = New-Object -ComObject Word.Application",
    "try {",
    "  $doc = $app.Documents.Open($env:BOLD_TARGET, $false, $false, $false)",
    "  $doc.Paragraphs(2).Range.Words(1).Bold = $true",
    "  $doc.Save(); $doc.Close(0)",
    "} finally { $app.Quit([ref]0) }",
  ].join("\n"),
  { BOLD_TARGET: path.join(root, "v", "spec-v1-bold.docx") },
);

type Execute = (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ text: string }> }>;
function tool(overrides: { timeoutMs?: number; environment?: RenderEnvironment } = {}) {
  const definition = createDocxCompareToolDefinition({
    cwd: root,
    allowedRoots: [root],
    writableRoot: root,
    maxBytes: 25 * 1024 * 1024,
    render: { timeoutMs: overrides.timeoutMs ?? 120_000 },
    ...(overrides.environment ? { environment: overrides.environment } : {}),
  });
  return (params: Record<string, unknown>) => (definition.execute as unknown as Execute)("probe", params).then((result) => result.content[0].text);
}
async function scenario(name: string, body: () => Promise<string>): Promise<void> {
  const started = Date.now();
  let outcome: string;
  try {
    outcome = await body();
  } catch (error) {
    outcome = `THREW: ${(error as Error).message}`;
  }
  console.log(`\n=== ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)\n${outcome}`);
}

const before = { listing: await readdir(path.join(root, "v")), v1: await readFile(path.join(root, "v", "spec-v1.docx")) };

await scenario("ComparedDocumentWritten", async () => {
  const text = await tool()({ original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path: "compared.docx" });
  const written = await readFile(path.join(root, "compared.docx"));
  return `${text}\n--- compared.docx: ${written.length} bytes`;
});

await scenario("SourcesUnchanged (real Word)", async () => {
  const listing = await readdir(path.join(root, "v"));
  const v1 = await readFile(path.join(root, "v", "spec-v1.docx"));
  return `listing unchanged: ${JSON.stringify(listing) === JSON.stringify(before.listing)}; spec-v1.docx byte-identical: ${v1.equals(before.v1)}`;
});

await scenario("FormattingDifferencesAreIgnored", () => tool()({ original: "v/spec-v1.docx", revised: "v/spec-v1-bold.docx" }));

await scenario("ComparisonTimesOut (1 s)", async () => {
  const outcome = await tool({ timeoutMs: 1_000 })({ original: "v/spec-v1.docx", revised: "v/spec-v2.docx" }).then(
    (text) => `returned: ${text.slice(0, 80)}`,
    (error: Error) => `refused: ${error.message}`,
  );
  // The killed PowerShell leaves its Word behind for a moment; say what is left.
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  return `${outcome}\n--- WINWORD.EXE running 15 s later: ${await wordProcesses()}`;
});

await scenario("UserDocumentsStayOpen", async () => {
  const userDocument = path.join(root, "mon-document.docx");
  await copyFile(path.join(root, "v", "spec-v1.docx"), userDocument);
  const stop = path.join(root, "stop");
  // The user's Word: visible, a document open, until told to look and let go.
  const user = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$app = New-Object -ComObject Word.Application; $app.Visible = $true",
        "$doc = $app.Documents.Open($env:USER_DOCUMENT)",
        "Write-Output 'ready'",
        "while (-not (Test-Path $env:STOP_FILE)) { Start-Sleep -Milliseconds 200 }",
        "$open = $false; try { $open = ($app.Documents.Count -ge 1 -and $doc.FullName -eq $env:USER_DOCUMENT) } catch { }",
        "Write-Output \"still-open=$open\"",
        "$doc.Close(0); $app.Quit([ref]0)",
      ].join("\n"),
    ],
    { env: { ...process.env, USER_DOCUMENT: userDocument, STOP_FILE: stop } },
  );
  let output = "";
  user.stdout.on("data", (chunk) => (output += chunk));
  while (!output.includes("ready")) await new Promise((resolve) => setTimeout(resolve, 200));
  const during = await wordProcesses();
  const text = await tool()({ original: "v/spec-v1.docx", revised: "v/spec-v2.docx" });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const after = await wordProcesses();
  await writeFile(stop, "");
  await new Promise((resolve) => user.on("exit", resolve));
  return `comparison returned ${text.split("\n").length} lines; WINWORD.EXE with the user's open: ${during}, 3 s after the comparison: ${after}; ${output.trim().split(/\r?\n/).pop()}`;
});

await scenario("WordMissing (Word.Application not registered)", async () => {
  // The real PowerShell and the real COM lookup, for a class no machine registers —
  // which is what a machine without Word answers for Word.Application.
  const real = defaultEnvironment();
  const environment: RenderEnvironment = {
    ...real,
    run: (file, args, options) => real.run(file, args.map((arg) => arg.replace("Word.Application", "Word.ApplicationNotInstalled")), options),
  };
  return tool({ environment })({ original: "v/spec-v1.docx", revised: "v/spec-v2.docx" });
});

console.log(`\n=== WINWORD.EXE left at the end: ${await wordProcesses()}`);
await rm(root, { recursive: true, force: true });
