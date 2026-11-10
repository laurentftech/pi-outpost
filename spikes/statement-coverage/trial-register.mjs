// A branch-only Linux experiment. No Node hook or dump is installed in unrelated children.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { isMainThread, parentPort, threadId } from 'node:worker_threads';
import { trialScope } from './trial-scope.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const entry=process.argv[1]?path.resolve(process.argv[1]):'';
const relative=path.relative(root,entry).split(path.sep).join('/');
const fixture=relative==='spikes/statement-coverage/trial-lifecycle-fixture.mjs'&&process.env.SPIKE_TRIAL_SELFTEST==='1';
// A worker thread's argv[1] is its own script. It is measured when its process is: the
// measured main thread marks its pid, which a child process (another pid) never matches.
const measuredThread=!isMainThread&&process.env.SPIKE_TRIAL_THREADS_OF===String(process.pid);
const allowed=measuredThread||fixture||relative==='server/src/index.ts'||/^(?:server|office)\/test\/[^/]+\.test\.(?:mjs|ts)$/.test(relative);
const dir=process.env.SPIKE_TRIAL_DIR;
if(process.env.SPIKE_TRIAL==='1'&&dir&&allowed){
  const { cachedExecutable }=await import('./trial-cache.mjs');
  const { startProcess,dump,writeJson }=await import('./trial-store.mjs');
  const id=isMainThread?`node-${process.pid}`:`node-${process.pid}-thread-${threadId}`;
  let started=false;
  const owner=/^(?:server|office)\/test\//.test(relative)?relative:(process.env.SPIKE_TRIAL_OWNER||relative);
  process.env.SPIKE_TRIAL_OWNER=owner;
  if(isMainThread)process.env.SPIKE_TRIAL_THREADS_OF=String(process.pid);
  const trace=(event,extra={})=>writeJson(path.join(dir,'lifecycle',`${id}-${event}.json`),
    {id,entry:relative,owner,event,time:new Date().toISOString(),pid:process.pid,ppid:process.ppid,...extra});
  const originalSpawn=childProcess.spawn;
  // Signals and child processes belong to the main thread; a worker only loads and runs code.
  if(isMainThread){
    childProcess.spawn=function(...args){
      const child=originalSpawn.apply(this,args);
      child.once('spawn',()=>writeJson(path.join(dir,'lifecycle',`node-${child.pid}-spawn.json`),
        {id:`node-${child.pid}`,owner,parent:process.pid,command:path.basename(String(args[0])),time:new Date().toISOString()}));
      child.once('close',(code,signal)=>writeJson(path.join(dir,'lifecycle',`node-${child.pid}-close.json`),
        {id:`node-${child.pid}`,owner,parent:process.pid,code,signal,time:new Date().toISOString()}));
      return child;
    };
    syncBuiltinESMExports();
  }
  registerHooks({load(url,context,nextLoad){
    const loaded=nextLoad(url,context);
    if(!url.startsWith('file:')||loaded.source==null)return loaded;
    const file=fileURLToPath(url);
    // Trial-only adaptation: preserve production files and the normal harness policy.
    if(file===path.join(root,'server/test/harness.mjs')){
      const source=String(loaded.source);
      const original='const stopped = await waitForExit(stopGraceMs());';
      if(source.split(original).length!==2)throw new Error('Trial shutdown adapter drift: review harness');
      return {...loaded,source:source.replace(original,'const stopped = await waitForExit(COVERAGE_STOP_GRACE_MS);')};
    }
    if(!['server','shared','office'].includes(trialScope(file)?.name))return loaded;
    if(!started){
      startProcess(dir,id,relative,{owner,pid:process.pid,ppid:process.ppid,...(isMainThread?{}:{thread:threadId})});
      started=true;trace('started');
      // A terminated worker gets no exit event: write its counters now, then before each
      // reply it posts (each request ends with one), so terminate() never loses a request.
      if(!isMainThread){
        setImmediate(()=>flush('thread-start'));
        if(parentPort){const post=parentPort.postMessage.bind(parentPort);parentPort.postMessage=(...args)=>{flush('thread-reply');return post(...args);};}
      }
    }
    return {...loaded,format:'module',source:cachedExecutable(dir,file)};
  }});
  const flush=(reason)=>{
    if(!started)return;
    trace('flush-start',{reason});
    if(fixture&&process.env.SPIKE_TRIAL_FLUSH_DELAY_MS)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.env.SPIKE_TRIAL_FLUSH_DELAY_MS));
    dump(dir,id,globalThis.__coverage__??{});
    trace('flush-done',{reason});
  };
  // A synchronous signal snapshot survives the harness's later SIGKILL fallback.
  // The app's existing SIGTERM handler and exit behavior are left in place.
  const onTerminate=()=>{
    flush('SIGTERM');
    if(process.listenerCount('SIGTERM')===1){
      // Restore Node's default termination when the application has no signal handler.
      process.removeListener('SIGTERM',onTerminate);
      process.kill(process.pid,'SIGTERM');
    }
  };
  if(isMainThread)process.on('SIGTERM',onTerminate);
  process.on('exit',(code)=>{trace('exit',{code});flush('exit');});
}
