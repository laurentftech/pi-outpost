import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { collect } from './trial-store.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const dir=path.join(here,'results',`lifecycle-${Date.now()}`);
const hook=pathToFileURL(path.join(here,'trial-register.mjs')).href;
async function run(mode,signal){
  const output=path.join(dir,`${mode}-${signal??'exit'}`);
  const child=spawn(process.execPath,['--import','tsx/esm',path.join(here,'trial-lifecycle-fixture.mjs'),mode],{
    cwd:root,env:{...process.env,NODE_OPTIONS:`--import=${hook}`,NODE_V8_COVERAGE:'',
      SPIKE_TRIAL:'1',SPIKE_TRIAL_SELFTEST:'1',SPIKE_TRIAL_DIR:output,
      SPIKE_TRIAL_OWNER:'lifecycle-selftest',SPIKE_TRIAL_FLUSH_DELAY_MS:signal==='SIGTERM'?'1000':''},
    stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  const closed=once(child,'close');
  let timeout=setTimeout(()=>child.kill('SIGKILL'),45000);
  let signalledAt;
  try{
    if(signal){
      const deadline=Date.now()+30000;
      while(!stdout.includes('READY')){
        assert.ok(Date.now()<deadline,'fixture readiness timeout: '+stderr);
        assert.equal(child.exitCode,null,stderr);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(stdout.includes('READY 15000'),'trial adapter provides the coverage shutdown allowance');
      clearTimeout(timeout);
      timeout=setTimeout(()=>child.kill('SIGKILL'),15000);
      signalledAt=Date.now();
      child.kill(signal);
    }
    const [code,actualSignal]=await closed;
    const result=collect(output);
    assert.equal(result.processes,1);
    if(signal==='SIGKILL'){
      assert.equal(actualSignal,'SIGKILL');
      assert.equal(result.missing.length,1,'unrecoverable kills must still invalidate collection');
    }else{
      assert.equal(result.missing.length,0,stderr);
      assert.ok(result.map.getCoverageSummary().statements.covered>0);
      if(mode==='fail')assert.equal(code,1);
      if(mode==='normal')assert.equal(code,0);
      if(signal==='SIGTERM'){
        assert.equal(actualSignal,'SIGTERM','collector preserves default signal exit');
        const done=JSON.parse(readFileSync(path.join(output,'lifecycle',`node-${child.pid}-flush-done.json`),'utf8'));
        assert.equal(done.reason,'SIGTERM');
        assert.ok(Date.now()-signalledAt>=1000,'slow flush exceeded the old 300ms allowance');
      }
    }
    const marker=JSON.parse(readFileSync(path.join(output,'expected',`node-${child.pid}.json`),'utf8'));
    assert.equal(marker.owner,'lifecycle-selftest');
    assert.ok(existsSync(path.join(output,'lifecycle',`node-${child.pid}-started.json`)));
  }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}
await run('normal');
await run('fail');
if(process.platform==='linux'){
  await run('signal','SIGTERM');
  await run('kill','SIGKILL');
}else console.log('POSIX SIGTERM/SIGKILL lifecycle assertions run in the Linux trial.');
console.log('Lifecycle: normal exit, failed startup, ownership and trial shutdown adapter verified.');
