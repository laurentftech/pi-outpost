import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
if(process.platform!=='linux')throw new Error('The full-suite trial requires Linux and graceful child shutdown');
const dir=path.join(here,'results','linux-trial');
mkdirSync(dir,{recursive:true});
const hook=pathToFileURL(path.join(here,'trial-register.mjs')).href;
const baseEnv={...process.env,NODE_V8_COVERAGE:'',PI_OUTPOST_TEST_COVERAGE_DIR:'',
  SPIKE_TRIAL:'1',SPIKE_TRIAL_DIR:dir,PI_OFFLINE:'1',CI:'true'};
const timings=[];
for(const [name,args,cwd=root] of [
  ['server',['server/scripts/test.mjs','--test-concurrency=2']],
  ['ui',['node_modules/vitest/vitest.mjs','run','--config','spikes/statement-coverage/vitest.trial.config.mts']],
  // office/src is also credited by every server suite that loads it; this is its own suite.
  ['office',['--import','tsx/esm','--test','--test-timeout=120000','test/*.test.ts'],path.join(root,'office')],
]){
  const start=performance.now();
  const env={...baseEnv,NODE_OPTIONS:name==='ui'?'':`--import=${hook}`};
  const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit',timeout:65*60*1000});
  timings.push({name,ms:performance.now()-start,status:result.status??1,error:result.error?.message});
  writeFileSync(path.join(dir,'timings.json'),JSON.stringify(timings,null,2));
}
const report=spawnSync(process.execPath,[path.join(here,'trial-report.mjs')],{cwd:root,
  env:{...process.env,SPIKE_TRIAL_DIR:dir,NODE_OPTIONS:'',NODE_V8_COVERAGE:''},stdio:'inherit'});
process.exitCode=timings.some(t=>t.status!==0)||report.status!==0?1:0;
