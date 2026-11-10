// Focused statement measurement while writing tests: run some server or office test files
// under the trial hook, then print each target file's statements and, with --lines, the
// source lines still uncovered. Any platform; the full trial (trial-run.mjs) stays Linux-only.
//
//   node spikes/statement-coverage/trial-focus.mjs [--lines] --files server/src/fileBrowser.ts \
//     -- server/test/fileBrowser.test.ts server/test/fileBrowserFailures.test.ts
//
// Or, with --report <coverage-final.json> and no test files, read a downloaded CI report instead.
// With --baseline <coverage-final.json> (a downloaded CI report of the same source), also count
// the statements that report left uncovered and these tests cover: what the tests would add.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import coverageLib from 'istanbul-lib-coverage';
import { collect } from './trial-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const split = args.indexOf('--');
const options = split === -1 ? args : args.slice(0, split);
const tests = split === -1 ? [] : args.slice(split + 1);
const lines = options.includes('--lines');
const value = (name) => { const i = options.indexOf(name); return i === -1 ? undefined : options[i + 1]; };
const targets = (value('--files') ?? '').split(',').filter(Boolean).map((f) => path.resolve(root, f));
const report = value('--report');
const baselineFile = value('--baseline');
const baseline = baselineFile ? coverageLib.createCoverageMap(JSON.parse(readFileSync(baselineFile, 'utf8'))) : undefined;
/** The file in `coverageMap` for `target`, by path or, for a CI report, by repository-relative path. */
const findIn = (coverageMap, target) => {
  const relative = path.relative(root, target).split(path.sep).join('/');
  return coverageMap.files().find((f) => path.resolve(f) === target || f.split('\\').join('/').endsWith(`/${relative}`));
};
if (targets.length === 0 || (tests.length === 0 && !report)) {
  console.error('usage: trial-focus.mjs [--lines] --files a.ts,b.ts (--report coverage-final.json | -- test files)');
  process.exit(2);
}

let map;
if (report) {
  map = coverageLib.createCoverageMap(JSON.parse(readFileSync(report, 'utf8')));
} else {
  const dir = path.join(here, 'results', 'focus');
  rmSync(dir, { recursive: true, force: true });
  const workspace = tests[0].startsWith('office/') ? 'office' : 'server';
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=180000',
    ...tests.map((t) => path.relative(path.join(root, workspace), path.resolve(root, t)))], {
    cwd: path.join(root, workspace), stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(path.join(here, 'trial-register.mjs')).href}`,
      SPIKE_TRIAL: '1', SPIKE_TRIAL_DIR: dir, PI_OFFLINE: '1', NODE_V8_COVERAGE: '' },
  });
  const out = result.stdout.toString();
  for (const line of out.split(/\r?\n/)) if (/^(?:# |ℹ )(?:tests|pass|fail) |^\s*(?:not ok|✖)/.test(line)) console.log(line);
  if (result.status !== 0) { console.log(out.slice(-6000)); process.exitCode = 1; }
  map = collect(dir).map;
}

for (const target of targets) {
  // A downloaded CI report names the runner's checkout: match it by the repository-relative path.
  const file = findIn(map, target);
  if (!file) { console.log(`${path.relative(root, target)}: not loaded`); continue; }
  const coverage = map.fileCoverageFor(file);
  const { covered, total } = coverage.toSummary().statements;
  console.log(`${path.relative(root, target)}: ${covered}/${total} statements (${total - covered} uncovered)`);
  const before = baseline && findIn(baseline, target);
  if (before) {
    const was = baseline.fileCoverageFor(before).toJSON();
    const now = coverage.toJSON();
    if (Object.keys(was.s).length !== total) console.log('  baseline has a different statement inventory: source changed since that report');
    else {
      const gained = Object.keys(now.s).filter((id) => now.s[id] > 0 && was.s[id] === 0).length;
      const left = Object.keys(was.s).filter((id) => was.s[id] === 0 && now.s[id] === 0).length;
      console.log(`  against the baseline: +${gained} statements (${Object.values(was.s).filter((n) => n > 0).length + gained}/${total}), ${left} still uncovered`);
    }
  }
  if (!lines) continue;
  const source = readFileSync(target, 'utf8').split(/\r?\n/);
  const data = coverage.toJSON();
  const missed = new Map();
  for (const [id, hits] of Object.entries(data.s)) if (hits === 0) {
    const line = data.statementMap[id].start.line;
    missed.set(line, (missed.get(line) ?? 0) + 1);
  }
  for (const line of [...missed.keys()].sort((a, b) => a - b)) {
    console.log(`${String(line).padStart(6)} ${String(missed.get(line)).padStart(2)}  ${source[line - 1].trim().slice(0, 140)}`);
  }
}
