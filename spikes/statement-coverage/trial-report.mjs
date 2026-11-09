import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import coverageLib from 'istanbul-lib-coverage';
import { collect } from './trial-store.mjs';
import { instrument } from './instrument.mjs';
import { trialScope,TRIAL_EXCLUSIONS } from './trial-scope.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=process.env.SPIKE_TRIAL_DIR;
if(!dir)throw new Error('SPIKE_TRIAL_DIR is required');
const output=path.join(dir,'report');
mkdirSync(output,{recursive:true});
const {map,missing,processes}=collect(dir);
const errors=missing.map(m=>`Missing or empty dump: ${m.id} (${m.entry}; owner: ${m.owner??"unknown"})`);
if(processes===0)errors.push('No measured processes: collection did not run');
const inventory=[];
function walk(at){
  for(const entry of readdirSync(at,{withFileTypes:true})){
    const file=path.join(at,entry.name);
    if(entry.isDirectory())walk(file);
    else if(trialScope(file))inventory.push(file);
  }
}
for(const scope of ['server','shared','ui'])walk(path.join(root,scope,'src'));
const files=[];
for(const file of inventory){
  // Runtime dumps are JSON: omit undefined placeholder positions identically on both sides.
  const expected=JSON.parse(JSON.stringify(instrument(readFileSync(file,'utf8'),file).coverage));
  const total=Object.keys(expected.s).length;
  if(!total&&Object.keys(expected.f).length===0)continue;
  if(map.files().includes(file)){
    const actual=map.fileCoverageFor(file).toJSON();
    try{
      assert.deepEqual(actual.statementMap,expected.statementMap);
      assert.deepEqual(actual.fnMap,expected.fnMap);
      assert.deepEqual(actual.branchMap,expected.branchMap);
    }catch{errors.push(`Instruction inventory drift: ${path.relative(root,file)}`);}
  }else map.addFileCoverage(expected);
  files.push({path:path.relative(root,file).split(path.sep).join('/'),scope:trialScope(file).name,summary:map.fileCoverageFor(file).toSummary().toJSON()});
}
for(const file of map.files())if(!inventory.includes(file))errors.push(`Measured file outside current inventory: ${file}`);
const scopes=Object.fromEntries(['server','shared','ui'].map(name=>{
  const group=coverageLib.createCoverageSummary();
  for(const file of files.filter(f=>f.scope===name))group.merge(file.summary);
  return [name,group.toJSON()];
}));
for(const [name,summary] of Object.entries(scopes))if(summary.statements.covered===0)errors.push(`${name}: zero covered instructions`);
const timingsFile=path.join(dir,'timings.json');
const timings=existsSync(timingsFile)?JSON.parse(readFileSync(timingsFile,'utf8')):[];
if(!['server','ui'].every(name=>timings.some(t=>t.name===name)))errors.push('Missing server/UI suite completion records');
if(timings.some(t=>t.status!==0))errors.push('One or more instrumented suites failed; this is not a passing coverage run');
const report={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,
  scope:'server/src, shared/src, ui/src only; other production workspaces and browser suites are not instrumented',
  tool:'istanbul-lib-instrument 6.0.3, applied to original TypeScript before transpilation',
  collectionIntegrity:errors.length===0,errors,processes,exclusions:TRIAL_EXCLUSIONS,scopes,files,timings};
writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));
writeFileSync(path.join(output,'coverage-final.json'),JSON.stringify(map.toJSON()));
const rows=Object.entries(scopes).map(([name,s])=>`| ${name} | ${s.statements.covered}/${s.statements.total} (${s.statements.pct}%) | ${s.branches.covered}/${s.branches.total} (${s.branches.pct}%) | ${s.functions.covered}/${s.functions.total} (${s.functions.pct}%) |`);
const markdown=`# Experimental statement coverage\n\nCommit: \`${report.commit}\`; Node ${report.node}.\n\n${report.tool}.\n\nIntegrity: **${report.collectionIntegrity?'PASS':'FAIL'}**; ${processes} measured process/suite dumps.\n\n${report.scope}. A daily report measures the default-branch commit named above; it does not establish coverage for every intervening commit or certify OpenSSF compliance on its own.\n\n| Scope | Statements | Branches | Functions |\n|---|---:|---:|---:|\n${rows.join('\n')}\n\n## Timings\n\n${timings.map(t=>`- ${t.name}: ${(t.ms/1000).toFixed(1)} s, exit ${t.status}`).join('\n')}\n\n## Exclusions\n\n${TRIAL_EXCLUSIONS.map(e=>`- \`${e.pattern}\`: ${e.reason}`).join('\n')}\n\n## Integrity errors\n\n${errors.length?errors.map(e=>'- '+e).join('\n'):'None.'}\n`;
writeFileSync(path.join(output,'summary.md'),markdown);
console.log(markdown);
if(errors.length)process.exitCode=1;
