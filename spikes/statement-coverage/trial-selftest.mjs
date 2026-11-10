import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { instrument,executable } from './instrument.mjs';
import { startProcess,dump,collect } from './trial-store.mjs';
import { largestGaps,gapsMarkdown } from './trial-gaps.mjs';
import { trialScope } from './trial-scope.mjs';
import { cachedExecutable,cacheKey } from './trial-cache.mjs';
{
  // Largest gaps: ranked by uncovered statements, then branches, then path; fully covered files left out.
  const metric=(covered,total)=>({covered,total,pct:total?Math.round(covered/total*10000)/100:100});
  const file=(p,scope,s,b)=>({path:p,scope,summary:{statements:metric(...s),branches:metric(...b)}});
  const files=[
    file('server/src/small.ts','server',[9,10],[4,4]),
    file('server/src/big.ts','server',[50,100],[10,20]),
    file('server/src/tieB.ts','server',[10,20],[1,5]),
    file('server/src/tieA.ts','server',[10,20],[1,5]),
    file('server/src/tieBranches.ts','server',[10,20],[0,8]),
    file('server/src/full.ts','server',[30,30],[6,6]),
    file('server/src/branchOnly.ts','server',[5,5],[1,2]),
    file('ui/src/view.tsx','ui',[1,4],[0,0]),
  ];
  assert.deepEqual(largestGaps(files,'server').map(g=>g.path),
    ['server/src/big.ts','server/src/tieBranches.ts','server/src/tieA.ts','server/src/tieB.ts','server/src/small.ts','server/src/branchOnly.ts'],
    'most uncovered statements first, then branches, then path; a fully covered file is not listed');
  assert.deepEqual(largestGaps(files,'server',2).map(g=>g.path),['server/src/big.ts','server/src/tieBranches.ts'],'limited to the requested count');
  assert.deepEqual(largestGaps(files,'shared'),[],'a scope with no file has no gap');
  const big=largestGaps(files,'server')[0];
  assert.equal(big.missedStatements,50);
  assert.equal(big.missedBranches,10);
  const md=gapsMarkdown(files,['server','shared','ui'],3);
  assert.match(md,/^## Largest gaps/);
  assert.match(md,/\| `server\/src\/big\.ts` \| 50 \| 50\/100 \(50%\) \| 10 \| 10\/20 \(50%\) \|/);
  assert.doesNotMatch(md,/small\.ts/,'beyond the limit');
  assert.match(md,/### shared\n\nNothing uncovered\./);
  assert.match(md,/\| `ui\/src\/view\.tsx` \| 3 \|/);
}
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const dir=path.join(here,'results',`store-selftest-${Date.now()}`);
mkdirSync(dir,{recursive:true});
const file=path.join(here,'fixture.ts');
{
  // The instrumentation cache serves exactly what instrumenting computes, computes it once,
  // and never serves one content's code for another.
  const cacheDir=path.join(dir,'cache');
  const first=cachedExecutable(cacheDir,file);
  assert.equal(first,executable(readFileSync(file,'utf8'),file).code,'cached code is the instrumented code');
  const entries=readdirSync(path.join(cacheDir,'instrumented'));
  assert.deepEqual(entries,[`${cacheKey(file,readFileSync(file,'utf8'))}.js`],'one entry, named by the content key, no temporary left');
  writeFileSync(path.join(cacheDir,'instrumented',entries[0]),'// served from the cache');
  assert.equal(cachedExecutable(cacheDir,file),'// served from the cache','a second load reads the cache instead of instrumenting again');
  assert.notEqual(cacheKey(file,readFileSync(file,'utf8')+'\n'),cacheKey(file,readFileSync(file,'utf8')),'changed content, different entry');
  assert.notEqual(cacheKey(path.join(here,'unloaded.ts'),readFileSync(file,'utf8')),cacheKey(file,readFileSync(file,'utf8')),'same content at another path, different entry');
}
const data=instrument(readFileSync(file,'utf8'),file).coverage;
assert.equal(Object.keys(data.s).length,11);
data.s['0']=1;
startProcess(dir,'first','unit fixture');
dump(dir,'first',{[file]:data});
let result=collect(dir);
assert.equal(result.missing.length,0);
assert.equal(result.map.getCoverageSummary().statements.covered,1);
assert.equal(result.map.getCoverageSummary().statements.total,11);
startProcess(dir,'second','child fixture');
assert.equal(collect(dir).missing.length,1,'missing process dump must be reported');
dump(dir,'second',{});
assert.equal(collect(dir).missing[0].reason,'empty dump');
const child=structuredClone(data);
child.s['0']=0;child.s['1']=1;
dump(dir,'second',{[file]:child});
result=collect(dir);
assert.equal(result.map.getCoverageSummary().statements.covered,2,'union across compact process dumps');
assert.equal(result.map.getCoverageSummary().statements.total,11,'metadata has one denominator');
assert.equal(readdirSync(path.join(dir,'metadata')).length,1,'source maps are stored once');
writeFileSync(path.join(dir,'dumps','second.json'),'{');
assert.throws(()=>collect(dir),SyntaxError,'truncated dumps must not disappear silently');
const hook=pathToFileURL(path.join(here,'trial-register.mjs')).href;
const unrelated=path.join(dir,'unrelated');
const env={...process.env,SPIKE_TRIAL:'1',SPIKE_TRIAL_DIR:unrelated,NODE_V8_COVERAGE:'',NODE_OPTIONS:`--import=${hook}`};
const untouched=spawnSync(process.execPath,['--input-type=module','--eval',"console.log('unrelated child')"],{cwd:root,env,encoding:'utf8'});
assert.equal(untouched.status,0,untouched.stderr);
assert.equal(untouched.stdout.trim(),'unrelated child');
assert.equal(existsSync(unrelated),false,'unrelated children must not create collection files');
const real=spawnSync(process.execPath,['--import','tsx/esm','--test','server/test/serverTransport.test.ts'],{cwd:root,
  env:{...env,SPIKE_TRIAL_DIR:path.join(dir,'real')},encoding:'utf8',timeout:120000});
assert.equal(real.status,0,real.stdout+'\n'+real.stderr);
const realData=collect(path.join(dir,'real'));
assert.equal(realData.missing.length,0);
assert.ok(realData.processes>0);
assert.ok(realData.map.files().includes(path.join(root,'server/src/config.ts')),'NODE_OPTIONS hook reaches the actual test worker');
const reportRun=spawnSync(process.execPath,[path.join(here,'trial-report.mjs')],{cwd:root,
  env:{...process.env,NODE_OPTIONS:'',NODE_V8_COVERAGE:'',SPIKE_TRIAL_DIR:path.join(dir,'real')},encoding:'utf8',timeout:120000});
assert.equal(reportRun.status,1,'a Node-only sample must fail the full three-scope integrity check');
const report=JSON.parse(readFileSync(path.join(dir,'real/report/summary.json'),'utf8'));
assert.deepEqual(report.errors,['ui: zero covered instructions','office: zero covered instructions','Missing server/UI/office suite completion records'],'complete inventory must compile with no source drift, but incomplete suites must remain flagged');
assert.ok(report.files.some(f=>f.scope==='ui'&&f.summary.statements.total>0&&f.summary.statements.covered===0),'unloaded UI code counts at zero');
const summaryMd=readFileSync(path.join(dir,'real/report/summary.md'),'utf8');
assert.match(summaryMd,/## Largest gaps[\s\S]*### server\n\n\| File \|[\s\S]*### ui\n\n\| File \| [\s\S]*## Timings/,'the summary lists each scope\'s largest gaps from the real per-file report');
const firstUi=largestGaps(report.files,'ui',1)[0];
assert.ok(summaryMd.includes(`| \`${firstUi.path}\` | ${firstUi.missedStatements} |`),'the table is the report\'s own per-file data');
// office/src: a trial-only scope, in the inventory with its files seeded, declarations excluded.
assert.equal(trialScope(path.join(root,'office/src/zip.ts'))?.name,'office');
assert.equal(trialScope(path.join(root,'office/src/types.d.ts')),undefined,'a declaration file stays excluded');
assert.equal(trialScope(path.join(root,'office/test/zipStream.test.ts')),undefined,'office tests are not production code');
assert.ok(report.files.some(f=>f.path==='office/src/zip.ts'&&f.scope==='office'&&f.summary.statements.total>0),'office files are in the inventory');
assert.match(summaryMd,/### office\n\n/);
// The hook admits the office suite's own test workers and credits office/src through them.
const office=spawnSync(process.execPath,['--import','tsx/esm','--test','test/zipStream.test.ts'],{cwd:path.join(root,'office'),
  env:{...env,SPIKE_TRIAL_DIR:path.join(dir,'office')},encoding:'utf8',timeout:120000});
assert.equal(office.status,0,office.stdout+'\n'+office.stderr);
const officeData=collect(path.join(dir,'office'));
assert.equal(officeData.missing.length,0);
const zipStream=officeData.map.fileCoverageFor(path.join(root,'office/src/zipStream.ts')).toSummary().statements;
assert.ok(zipStream.covered>0,'an office test worker credits office/src');
const grace=spawnSync(process.execPath,['--import','tsx/esm','--test','--test-name-pattern=^stop','server/test/coverageRun.test.mjs'],{cwd:root,
  env:{...env,SPIKE_TRIAL_DIR:path.join(dir,'grace')},encoding:'utf8',timeout:120000});
assert.equal(grace.status,0,grace.stdout+'\n'+grace.stderr);
await import('./trial-lifecycle-selftest.mjs');
console.log('Compact dump union, missing/empty/truncated data, unrelated-child gate and real Node test worker passed.');
