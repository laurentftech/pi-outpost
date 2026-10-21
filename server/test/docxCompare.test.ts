/**
 * docx_compare as the agent calls it, with Word replaced by an injected machine.
 *
 * Word is not on CI, so the machine hands back what the real Word wrote:
 *
 * - `fixtures/docx-compare-word-result.docx` — Word 16.0 comparing the two versions of
 *   `docx-review-office-web.docx` (every change rejected → every change accepted),
 *   produced by `scripts/probes/word-compare.ps1`;
 * - `fixtures/docx-compare-word-identical.docx` — Word comparing the rejected version
 *   with a copy of itself.
 *
 * What only the real Word can show — moves found, formatting ignored, the user's
 * documents left open, the timeout — is recorded in the change's scenario-coverage.md.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import {
  COMPARE_SCRIPT,
  COMPARISON_AUTHOR,
  compareWithWord,
  comparisonAnswer,
  createDocxCompareToolDefinition,
  type DocxCompareToolOptions,
} from "../src/docxCompare.ts";
import type { ProcessResult, RenderEnvironment } from "../src/presentationRender.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const WORD_RESULT = path.join(FIXTURES, "docx-compare-word-result.docx");
const WORD_IDENTICAL = path.join(FIXTURES, "docx-compare-word-identical.docx");
const SOURCE = path.join(FIXTURES, "docx-review-office-web.docx");

interface Call {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** The two copies Word was handed, read while it ran. */
  copies: { original: Buffer; revised: Buffer };
}

/** A Windows machine whose Word writes `result` — or fails, or runs out of time. */
function machine(outcome: { result?: string; fail?: string; timeout?: boolean; platform?: NodeJS.Platform } = {}): {
  environment: RenderEnvironment;
  calls: Call[];
} {
  const calls: Call[] = [];
  const environment: RenderEnvironment = {
    platform: outcome.platform ?? "win32",
    env: { SystemRoot: "C:\\Windows", PATH: "" },
    isFile: async () => false,
    run: async (file, args, options): Promise<ProcessResult> => {
      calls.push({
        file,
        args,
        env: options.env,
        copies: {
          original: await readFile(options.env.PI_OUTPOST_COMPARE_ORIGINAL!),
          revised: await readFile(options.env.PI_OUTPOST_COMPARE_REVISED!),
        },
      });
      if (outcome.timeout) return { code: null, stdout: "", stderr: "", timedOut: true };
      if (outcome.fail !== undefined) return { code: 1, stdout: "", stderr: outcome.fail, timedOut: false };
      await writeFile(options.env.PI_OUTPOST_COMPARE_OUTPUT!, await readFile(outcome.result ?? WORD_RESULT));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    },
  };
  return { environment, calls };
}

type Tool = ReturnType<typeof createDocxCompareToolDefinition>;
async function call(tool: Tool, params: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const execute = tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ text: string }> }>;
  return (await execute("call-1", params, signal)).content[0].text;
}

let root: string;
let options: Omit<DocxCompareToolOptions, "environment">;

before(async () => {
  root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-docx-compare-")));
  await mkdir(path.join(root, "v"));
  await writeFile(path.join(root, "v", "spec-v1.docx"), await readFile(SOURCE));
  await writeFile(path.join(root, "v", "spec-v2.docx"), await readFile(WORD_RESULT));
  options = { cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 10 * 1024 * 1024, render: { timeoutMs: 5_000 } };
});

describe("running Word", () => {
  test("paths reach the script only through the environment, with the comparison's author", async () => {
    const { environment, calls } = machine();
    const original = await readFile(SOURCE);
    const revised = await readFile(WORD_RESULT);
    const bytes = await compareWithWord(original, revised, { timeoutMs: 5_000 }, environment);
    assert.deepEqual(bytes, await readFile(WORD_RESULT));

    assert.equal(calls.length, 1);
    const [run] = calls;
    assert.equal(run.file, path.win32.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    assert.deepEqual(run.args, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", COMPARE_SCRIPT]);
    assert.equal(run.env.PI_OUTPOST_COMPARE_AUTHOR, COMPARISON_AUTHOR);
    assert.equal(COMPARISON_AUTHOR, "Word comparison");
    for (const name of ["ORIGINAL", "REVISED", "OUTPUT"]) {
      const value = run.env[`PI_OUTPOST_COMPARE_${name}`]!;
      assert.ok(path.isAbsolute(value));
      assert.ok(!run.args.some((arg) => arg.includes(value)), `${name} must not be on the command line`);
    }
    // The script reads them by name, and spells the author the same way.
    for (const name of ["ORIGINAL", "REVISED", "OUTPUT", "AUTHOR"]) assert.match(COMPARE_SCRIPT, new RegExp(`\\$env:PI_OUTPOST_COMPARE_${name}\\b`));
    // A failure is reported as its message, in UTF-8, not as PowerShell's wrapped error record.
    assert.match(COMPARE_SCRIPT, /^\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8$/m);
    assert.match(COMPARE_SCRIPT, /^\} catch \{\n {2}\[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\); exit 1\n\} finally \{$/m);
    // Word is never told to quit while a document is open in it.
    assert.match(COMPARE_SCRIPT, /if \(\$app -ne \$null -and \$app\.Documents\.Count -eq 0\) \{ \$app\.Quit\(\[ref\]0\) \}/);
  });

  test("Word works on private copies, removed afterwards", async () => {
    const { environment, calls } = machine();
    const original = await readFile(SOURCE);
    const revised = await readFile(WORD_RESULT);
    await compareWithWord(original, revised, { timeoutMs: 5_000 }, environment);
    const [run] = calls;
    assert.deepEqual(run.copies.original, original);
    assert.deepEqual(run.copies.revised, revised);
    const workDir = path.dirname(run.env.PI_OUTPOST_COMPARE_ORIGINAL!);
    assert.equal(path.dirname(workDir), path.resolve(tmpdir()));
    assert.equal(path.dirname(run.env.PI_OUTPOST_COMPARE_OUTPUT!), workDir);
    await assert.rejects(readdir(workDir), { code: "ENOENT" });
  });

  test("ComparisonTimesOut: the failure names the timeout", async () => {
    const { environment } = machine({ timeout: true });
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 7_000 }, environment), (error: Error) => {
      assert.match(error.message, /^Word did not finish the comparison within 7 s \(office\.renderTimeoutMs\)\./);
      return true;
    });
  });

  test("WordMissing: a failed run says Word is unavailable and names the manual path", async () => {
    const { environment } = machine({ fail: "New-Object : Retrieving the COM class factory for component with CLSID {000209FF} failed" });
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment), (error: Error) => {
      assert.match(error.message, /^Microsoft Word is unavailable: New-Object : Retrieving the COM class factory/);
      assert.match(error.message, /Review → Compare/);
      assert.match(error.message, /docx_extract and review: true/);
      return true;
    });
  });

  test("WordMissing: PowerShell's error record is reduced to its message", async () => {
    // What the real PowerShell printed on the Windows machine for an unregistered class.
    const { environment } = machine({
      fail: [
        "New-Object : Récupération de la fabrique de classes COM pour le composant avec le CLSID {00000000-0000-0000-0000-000000000000} a échoué.",
        "Au caractère Ligne:4 : 10",
        "+   $app = New-Object -ComObject Word.Application",
        "+          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "    + CategoryInfo          : ResourceUnavailable: (:) [New-Object], COMException",
        "    + FullyQualifiedErrorId : NoCOMClassIdentified,Microsoft.PowerShell.Commands.NewObjectCommand",
        "",
      ].join("\r\n"),
    });
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment), (error: Error) => {
      assert.match(error.message, /^Microsoft Word is unavailable: New-Object : Récupération de la fabrique de classes COM pour le composant avec le CLSID \{[-0]+\} a échoué\. To compare by hand/);
      assert.doesNotMatch(error.message, /CategoryInfo|~~~/);
      return true;
    });
  });

  test("a run that exits cleanly without writing the result is a failure, not an empty comparison", async () => {
    const { environment } = machine();
    environment.run = async () => ({ code: 0, stdout: "", stderr: "", timedOut: false });
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment), /^Error: Microsoft Word is unavailable: exited with code 0\./);
  });

  test("off Windows nothing is run, and the manual path is named", async () => {
    const { environment, calls } = machine({ platform: "linux" });
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment), /only available on Windows.*Review → Compare/);
    assert.equal(calls.length, 0);
  });

  test("a stopped turn does not start Word", async () => {
    const { environment, calls } = machine();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment, controller.signal), /The comparison was stopped/);
    assert.equal(calls.length, 0);
  });

  test("a turn stopped while Word runs is reported as stopped, not as Word missing", async () => {
    const controller = new AbortController();
    const { environment } = machine();
    environment.run = async () => {
      controller.abort();
      return { code: null, stdout: "", stderr: "AbortError: The operation was aborted", timedOut: false };
    };
    await assert.rejects(compareWithWord(Buffer.from("a"), Buffer.from("b"), { timeoutMs: 5_000 }, environment, controller.signal), /The comparison was stopped/);
  });
});

describe("the answer", () => {
  test("DifferencesAreMarkedInTheReviewFormat: deletions, insertions and moves, each listed with its section", async () => {
    const text = await comparisonAnswer(await readFile(WORD_RESULT), { original: "v1.docx", revised: "v2.docx" });
    // The reworded sentence and the removed paragraph of the fixture's two versions.
    assert.match(text, /This document was written by the Open WebUI tool server \{\+\+and for Claude Desktop\+\+\}\[r1\] from one call/);
    assert.match(text, /\{--a PowerPoint deck from slides;--\}\[r2\]/);
    assert.match(text, /\{--Laurent--\}\[r4\]\{\+\+Arthur\+\+\}\[r5\]/);
    // Word found the table row that moved.
    assert.match(text, /\{--Mermaid renderer--\}\[m1\]/);
    assert.match(text, /\{\+\+Mermaid renderer\+\+\}\[m1\]/);
    assert.match(text, /^- \[r2\] deletion — Word comparison, 2026-10-21 — Rollout of the office tools > What ships$/m);
    assert.match(text, /^- \[r1\] insertion — Word comparison, 2026-10-21 — Rollout of the office tools$/m);
    assert.match(text, /^- \[m1\] moved — Word comparison, 2026-10-21 — from Rollout of the office tools > What ships to Rollout of the office tools > What ships$/m);
  });

  test("AuthorshipIsNotAttributed: it opens with both files, and every change carries the comparison's author", async () => {
    const text = await comparisonAnswer(await readFile(WORD_RESULT), { original: "v/spec-v1.docx", revised: "v/spec-v2.docx" });
    const [opening] = text.split("\n\n");
    assert.equal(
      opening,
      '> Compared by Microsoft Word: "v/spec-v1.docx" → "v/spec-v2.docx". ' +
        "The authors and dates on the changes below are the comparison's, not those of whoever edited the document.",
    );
    const changes = text.split("\n").filter((line) => /^- \[[rm]\d+\]/.test(line));
    assert.equal(changes.length, 12);
    for (const line of changes) assert.match(line, /^- \[[rm]\d+\] [a-z ]+ — Word comparison, /);
    // A comment is the document's own, and keeps its author.
    assert.match(text, /^- \[c1\] comment, open — Laurent FRANCOISE, /m);
  });

  test("IdenticalVersions: Word found no difference, and the text is not returned as changes", async () => {
    const text = await comparisonAnswer(await readFile(WORD_IDENTICAL), { original: "a.docx", revised: "b.docx" });
    const paragraphs = text.split("\n\n");
    assert.match(paragraphs[0], /^> Compared by Microsoft Word: "a\.docx" → "b\.docx"\./);
    assert.equal(paragraphs[1], "Word found no difference between the two versions' text (formatting is not compared).");
    assert.equal(paragraphs.length, 2);
    assert.doesNotMatch(text, /Rollout of the office tools/);
  });

  test("the written path closes the answer", async () => {
    const text = await comparisonAnswer(await readFile(WORD_IDENTICAL), { original: "a.docx", revised: "b.docx", written: "out/compared.docx" });
    assert.match(text, /\n\nSaved the compared document, with Word's tracked changes, to `out\/compared\.docx`\.$/);
  });

  test("a result that is not a Word document is reported, not read as no difference", async () => {
    await assert.rejects(comparisonAnswer(Buffer.from("not a zip"), { original: "a.docx", revised: "b.docx" }), /^Error: Word's compared document could not be read: /);
  });
});

describe("docx_compare", () => {
  test("ComparedDocumentWritten: Word's document is written to output_path and named in the answer", async () => {
    const { environment } = machine();
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    const text = await call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path: "compared-written.docx" });
    assert.deepEqual(await readFile(path.join(root, "compared-written.docx")), await readFile(WORD_RESULT));
    assert.match(text, /^> Compared by Microsoft Word: "v\/spec-v1\.docx" → "v\/spec-v2\.docx"\./);
    assert.match(text, /Saved the compared document, with Word's tracked changes, to `compared-written\.docx`\.$/);
  });

  test("SourcesUnchanged: both files are byte-identical afterwards and their directory holds no new file", async () => {
    const { environment } = machine();
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    const folder = path.join(root, "v");
    const before = { listing: await readdir(folder), v1: await readFile(path.join(folder, "spec-v1.docx")), v2: await readFile(path.join(folder, "spec-v2.docx")) };
    await call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx" });
    assert.deepEqual(await readdir(folder), before.listing);
    assert.deepEqual(await readFile(path.join(folder, "spec-v1.docx")), before.v1);
    assert.deepEqual(await readFile(path.join(folder, "spec-v2.docx")), before.v2);
  });

  test("InputOutsideTheSandbox: either path outside the root is refused and Word is not started", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "pi-docx-compare-outside-"));
    await writeFile(path.join(outside, "secret.docx"), await readFile(SOURCE));
    for (const params of [
      { original: path.join(outside, "secret.docx"), revised: "v/spec-v2.docx" },
      { original: "v/spec-v1.docx", revised: "../" + path.basename(outside) + "/secret.docx" },
    ]) {
      const { environment, calls } = machine();
      const tool = createDocxCompareToolDefinition({ ...options, environment });
      await assert.rejects(call(tool, params), /^Error: Access denied: ".*" is outside the sandbox/);
      assert.equal(calls.length, 0);
    }
  });

  test("InputOutsideTheSandbox: a link inside the root to a file outside it is refused", async (t) => {
    const outside = await mkdtemp(path.join(tmpdir(), "pi-docx-compare-linked-"));
    await writeFile(path.join(outside, "secret.docx"), await readFile(SOURCE));
    try {
      await symlink(path.join(outside, "secret.docx"), path.join(root, "v", "linked.docx"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return t.skip("this account may not create symbolic links");
      throw error;
    }
    const { environment, calls } = machine();
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    try {
      await assert.rejects(call(tool, { original: "v/linked.docx", revised: "v/spec-v2.docx" }), /^Error: Access denied: "v\/linked\.docx" is outside the sandbox/);
      assert.equal(calls.length, 0);
    } finally {
      await rm(path.join(root, "v", "linked.docx"));
    }
  });

  test("OversizeInputRefused:a file above the Word size ceiling is refused, naming the limit, and Word is not started", async () => {
    const { environment, calls } = machine();
    const tool = createDocxCompareToolDefinition({ ...options, maxBytes: 1024, environment });
    await assert.rejects(call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx" }), /^Error: "v\/spec-v1\.docx" is larger than the 1 KB Word limit$/);
    assert.equal(calls.length, 0);
  });

  test("DestinationRefused: outside the writable zone, writing disabled, or a file already there", async () => {
    await writeFile(path.join(root, "taken.docx"), "already here");
    const cases: Array<{ output_path: string; writableRoot?: string | null; message: RegExp }> = [
      { output_path: "../elsewhere.docx", message: /outside the writable zone/ },
      { output_path: "compared-ro.docx", writableRoot: null, message: /this sandbox is read-only/ },
      { output_path: "taken.docx", message: /^Error: "taken\.docx" already exists; choose another path for the compared document\.$/ },
      { output_path: "compared.pdf", message: /^Error: "compared\.pdf" must end in \.docx\.$/ },
    ];
    for (const { output_path, writableRoot, message } of cases) {
      const { environment, calls } = machine();
      const tool = createDocxCompareToolDefinition({ ...options, ...(writableRoot === undefined ? {} : { writableRoot }), environment });
      await assert.rejects(call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path }), message);
      assert.equal(calls.length, 0, `${output_path}: Word must not start`);
    }
    assert.equal(await readFile(path.join(root, "taken.docx"), "utf8"), "already here");
    await assert.rejects(readFile(path.join(root, "compared-ro.docx")), { code: "ENOENT" });
  });

  test("a destination folder that does not exist is named, before Word starts", async () => {
    const { environment, calls } = machine();
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    await assert.rejects(call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path: "missing/compared.docx" }), /^Error: The folder for "missing\/compared\.docx" does not exist\.$/);
    assert.equal(calls.length, 0);
  });

  test("a destination folder removed while Word ran is named", async () => {
    await mkdir(path.join(root, "gone"));
    const { environment } = machine();
    const run = environment.run;
    environment.run = async (file, args, runOptions) => {
      await rm(path.join(root, "gone"), { recursive: true });
      return run(file, args, runOptions);
    };
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    await assert.rejects(call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path: "gone/compared.docx" }), /^Error: The folder for "gone\/compared\.docx" does not exist\.$/);
  });

  test("a destination taken while Word ran is not overwritten", async () => {
    const { environment } = machine();
    const run = environment.run;
    environment.run = async (file, args, runOptions) => {
      await writeFile(path.join(root, "raced.docx"), "written meanwhile");
      return run(file, args, runOptions);
    };
    const tool = createDocxCompareToolDefinition({ ...options, environment });
    await assert.rejects(call(tool, { original: "v/spec-v1.docx", revised: "v/spec-v2.docx", output_path: "raced.docx" }), /"raced\.docx" already exists/);
    assert.equal(await readFile(path.join(root, "raced.docx"), "utf8"), "written meanwhile");
  });
});
