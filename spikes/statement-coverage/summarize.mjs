import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import coverageLib from 'istanbul-lib-coverage';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const benchmark=JSON.parse(readFileSync(path.join(here,'results/benchmark.json'),'utf8'));
const fixtures=JSON.parse(readFileSync(path.join(here,'results/fixtures/summary.json'),'utf8'));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const timings=[];
for(const suite of ['server-unit','real-server-child','ui']){
  const values=Object.fromEntries(['baseline','v8','istanbul'].map(mode=>[mode,benchmark.rounds.filter(r=>r.suite===suite&&r.mode===mode).map(r=>r.ms)]));
  assert.ok(Object.values(values).every(v=>v.length===3),'three samples for every mode and suite');
  const medians=Object.fromEntries(Object.entries(values).map(([m,v])=>[m,median(v)]));
  timings.push({suite,samplesMs:values,medianMs:medians,istanbulOverV8:medians.istanbul/medians.v8});
}
const dir=path.join(root,benchmark.outputDirectory);
const shared=path.join(root,'shared/src/markdownMath.ts');
const server=JSON.parse(readFileSync(path.join(dir,'real-server-child-istanbul-0/merged.json'),'utf8'))[shared];
const ui=JSON.parse(readFileSync(path.join(dir,'ui-istanbul-0/merged.json'),'utf8'))[shared];
assert.ok(server&&ui,'the real server and UI both contribute the same shared source');
assert.deepEqual(server.statementMap,ui.statementMap,'one instruction inventory across Node and Vite');
assert.deepEqual(server.fnMap,ui.fnMap,'one function inventory across Node and Vite');
assert.deepEqual(server.branchMap,ui.branchMap,'one branch inventory across Node and Vite');
const union=coverageLib.createCoverageMap({[shared]:structuredClone(server)});
union.merge({[shared]:structuredClone(ui)});
const merged=union.fileCoverageFor(shared).toJSON();
for(const id of Object.keys(server.s))assert.equal(Boolean(merged.s[id]),Boolean(server.s[id]||ui.s[id]),`union for statement ${id}`);
const sharedUnion={server:coverageLib.createFileCoverage(server).toSummary().toJSON(),ui:coverageLib.createFileCoverage(ui).toSummary().toJSON(),merged:union.getCoverageSummary().toJSON(),identicalInventories:true};
const config=path.join(root,'server/src/config.ts');
const unit=JSON.parse(readFileSync(path.join(dir,'server-unit-istanbul-0/merged.json'),'utf8'))[config];
const child=JSON.parse(readFileSync(path.join(dir,'real-server-child-istanbul-0/merged.json'),'utf8'))[config];
assert.deepEqual(unit.statementMap,child.statementMap,'unit and integration use the same source instruction inventory');
const both=coverageLib.createCoverageMap({[config]:structuredClone(unit)});
both.merge({[config]:structuredClone(child)});
const combined=both.fileCoverageFor(config).toJSON();
for(const id of Object.keys(unit.s))assert.equal(Boolean(combined.s[id]),Boolean(unit.s[id]||child.s[id]),`unit/integration union ${id}`);
const unitIntegrationUnion={unit:coverageLib.createFileCoverage(unit).toSummary().toJSON(),child:coverageLib.createFileCoverage(child).toSummary().toJSON(),merged:both.getCoverageSummary().toJSON(),identicalInventories:true};
const result={baseCommit:benchmark.commit,node:benchmark.node,platform:benchmark.platform,cpu:benchmark.cpu,
  scope:'Small controlled fixtures and selected real tests only; not full-suite/product coverage or a CI runtime forecast.',
  fixtures,timings,sharedUnion,unitIntegrationUnion};
if(result.fixtures['repo-esm-tsx'])result.fixtures['repo-esm-tsx'].error='Must use import to load ES Module (fixture.ts)';
writeFileSync(path.join(here,'findings.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({timings,sharedUnion},null,2));
