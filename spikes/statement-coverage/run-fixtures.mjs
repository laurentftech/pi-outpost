import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { convert } from 'ast-v8-to-istanbul';
import { parseAstAsync } from 'vite';
import coverageLib from 'istanbul-lib-coverage';
import { instrument } from './instrument.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { createCoverageMap, createFileCoverage } = coverageLib;
const root = path.resolve(here, '../..');
const out = path.join(here, 'results', 'fixtures');
const file = path.join(here, 'fixture.ts');
const hook = pathToFileURL(path.join(here, 'register.mjs')).href;
const summary = c => createFileCoverage(c).toSummary().toJSON();
const output = {};
function run(args, env = {}, cwd = root, allowFailure = false) {
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, NODE_V8_COVERAGE: '', ...env }, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (!allowFailure) assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return { ms: performance.now() - start, status: result.status, pid: result.pid, stdout: result.stdout, stderr: result.stderr };
}
function jsonFiles(dir, prefix) {
  return readdirSync(dir).filter(n => n.startsWith(prefix) && n.endsWith('.json')).map(n => JSON.parse(readFileSync(path.join(dir,n),'utf8')));
}
function statementAt(c, line) {
  return Object.entries(c.statementMap).filter(([,v]) => v.start.line === line).map(([id]) => c.s[id]);
}

mkdirSync(out, { recursive: true });
for (const mode of ['istanbul', 'v8']) {
  const dir = path.join(out, `${mode}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const timings = [];
  let parentPid;
  for (const side of ['', 'child']) {
    const result = run(['--import','tsx/esm','--import',hook,path.join(here,'fixture-runner.mjs'),side], {
      SPIKE_MODE: mode, SPIKE_INCLUDE: JSON.stringify([file]), SPIKE_COVERAGE_DIR: dir,
      NODE_V8_COVERAGE: mode === 'v8' ? dir : '',
    });
    timings.push(result.ms);
    if (!side) parentPid = result.pid;
  }
  const map = createCoverageMap({});
  let first;
  if (mode === 'istanbul') {
    first = JSON.parse(readFileSync(path.join(dir,`spike-istanbul-${parentPid}.json`),'utf8'))[file];
    for (const c of jsonFiles(dir,'spike-istanbul-')) map.merge(c);
  } else {
    const sources = Object.assign({}, ...jsonFiles(dir,'spike-v8-').map(v=>v.sources));
    const raws = readdirSync(dir).filter(n=>n.startsWith('coverage-')&&n.endsWith('.json')).sort((a,b)=>Number(b.startsWith(`coverage-${parentPid}-`))-Number(a.startsWith(`coverage-${parentPid}-`)));
    for (const name of raws) {
      const raw = JSON.parse(readFileSync(path.join(dir,name),'utf8'));
      const entry = raw.result.find(e=>e.url===pathToFileURL(file).href);
      if (!entry) continue;
      const code = sources[entry.url];
      assert.ok(code, 'executed JavaScript must be available');
      const converted = await convert({ ast: parseAstAsync(code), code, coverage: entry, wrapperLength: 0 });
      first ??= structuredClone(Object.values(converted)[0]);
      map.merge(converted);
    }
  }
  const merged = map.fileCoverageFor(file).toJSON();
  if (mode === 'istanbul') {
    assert.equal(Object.keys(first.s).length, 11, 'eleven manually enumerated instructions');
    assert.equal(Object.values(first.s).filter(Boolean).length, 6, 'six executed instructions in the parent');
    assert.deepEqual(statementAt(first,6), [1,1], 'two instructions on the same line');
    assert.deepEqual(statementAt(first,12), [0], 'instruction after a throw must be unexecuted');
    assert.deepEqual(statementAt(first,15), [0], 'uncalled function remains uncovered');
    assert.deepEqual(statementAt(first,16), [0,0], 'child-only instructions absent in parent');
    assert.equal(Object.values(merged.s).filter(Boolean).length, 9, 'union credits the child without double-counting');
    assert.ok(Object.values(first.statementMap).every(l=>l.start.line>4), 'type-only declarations and comments excluded');
    const unloaded = path.join(here,'unloaded.ts');
    map.addFileCoverage(instrument(readFileSync(unloaded,'utf8'),unloaded).coverage);
    assert.equal(map.fileCoverageFor(unloaded).toSummary().statements.total,2);
    assert.equal(map.fileCoverageFor(unloaded).toSummary().statements.covered,0);
    assert.equal(map.getCoverageSummary().statements.total,13);
    assert.equal(map.getCoverageSummary().statements.covered,9);
  }
  output[mode] = { timingsMs: timings, first: summary(first), merged: summary(merged), afterThrowHits: statementAt(first,12), files: map.files().length };
  writeFileSync(path.join(out,`${mode}-map.json`),JSON.stringify(map.toJSON(),null,2));
}

// The official tutorial's require/ts-node recipe, followed by the repository's ESM/tsx shape.
const require = createRequire(import.meta.url);
const nyc = require.resolve('nyc/bin/nyc.js');
const tsnode = require.resolve('ts-node/register');
const smsupport = require.resolve('source-map-support/register');
const recipe = path.join(out,'recipe');
mkdirSync(recipe,{recursive:true});
writeFileSync(path.join(recipe,'package.json'),' {"type":"commonjs"}');
writeFileSync(path.join(recipe,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'CommonJS',sourceMap:true,types:['node']}}));
writeFileSync(path.join(recipe,'fixture.ts'),readFileSync(file));
writeFileSync(path.join(recipe,'run.cjs'),"const m=require('./fixture.ts');if(m.choose(true)!==3)throw Error('wrong');try{m.interrupted()}catch{}\n");
for (const shape of ['tutorial-commonjs','repo-esm-tsx','repo-esm-without-all']) {
  const dir = path.join(out,shape);
  const cwd = shape==='tutorial-commonjs'?recipe:root;
  const include = shape==='tutorial-commonjs'?'fixture.ts':path.relative(root,file).split(path.sep).join('/');
  const command = shape==='tutorial-commonjs'?['--require',tsnode,'--require',smsupport,path.join(recipe,'run.cjs')]:['--import','tsx/esm',path.join(here,'fixture-runner.mjs')];
  const result=run([nyc,'--cwd',cwd,'--extension','.ts',shape==='repo-esm-without-all'?'--all=false':'--all','--require',tsnode,'--include',include,'--reporter=json','--report-dir',dir,'--temp-directory',path.join(dir,'raw'),process.execPath,...command],{TS_NODE_PROJECT:path.join(recipe,'tsconfig.json')},cwd,shape==='repo-esm-tsx');
  if (shape==='repo-esm-tsx') {
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Must use import to load ES Module/);
    output[shape]={ms:result.ms,status:result.status,error:result.stderr.trim()};
    continue;
  }
  const report=JSON.parse(readFileSync(path.join(dir,'coverage-final.json'),'utf8'));
  output[shape]={ms:result.ms,files:Object.keys(report).length,summaries:Object.values(report).map(summary)};
  if (shape==='repo-esm-without-all') assert.equal(Object.keys(report).length,0,'ESM execution is silently unmeasured by the require hook');
}
writeFileSync(path.join(out,'summary.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
