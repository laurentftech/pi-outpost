// A branch-only Linux experiment. No Node hook or dump is installed in unrelated children.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { trialScope } from './trial-scope.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const entry=process.argv[1]?path.resolve(process.argv[1]):'';
const relative=path.relative(root,entry).split(path.sep).join('/');
const allowed=relative==='server/src/index.ts'||/^server\/test\/[^/]+\.test\.(?:mjs|ts)$/.test(relative);
const dir=process.env.SPIKE_TRIAL_DIR;
if(process.env.SPIKE_TRIAL==='1'&&dir&&allowed){
  const { executable }=await import('./instrument.mjs');
  const { startProcess,dump }=await import('./trial-store.mjs');
  const id=`node-${process.pid}`;
  let started=false;
  registerHooks({load(url,context,nextLoad){
    const loaded=nextLoad(url,context);
    if(!url.startsWith('file:')||loaded.source==null)return loaded;
    const file=fileURLToPath(url);
    if(!['server','shared'].includes(trialScope(file)?.name))return loaded;
    if(!started){startProcess(dir,id,relative);started=true;}
    return {...loaded,format:'module',source:executable(readFileSync(file,'utf8'),file).code};
  }});
  const flush=()=>{if(started)dump(dir,id,globalThis.__coverage__??{});};
  // A synchronous signal snapshot survives the harness's later SIGKILL fallback.
  // The app's existing SIGTERM handler and exit behavior are left in place.
  const onTerminate=()=>{
    flush();
    if(process.listenerCount('SIGTERM')===1){
      // Restore Node's default termination when the application has no signal handler.
      process.removeListener('SIGTERM',onTerminate);
      process.kill(process.pid,'SIGTERM');
    }
  };
  process.on('SIGTERM',onTerminate);
  process.on('exit',flush);
}
