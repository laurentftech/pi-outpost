import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, freePort, makeWorkspace } from '../../server/test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await makeWorkspace({'proof.txt':'real server child'});
const port = await freePort();
const config = path.join(root,'config.json');
const token = 'spike-token-not-a-production-secret';
await writeFile(config,JSON.stringify({cwd:root,agentDir:path.join(root,'.pi-agent'),sandbox:false,
  noSkills:true,noPromptTemplates:true,webContext:false,openBrowser:false,updateCheck:false,
  server:{host:'127.0.0.1',port,token}}));
const args=['--import','tsx/esm'];
if(process.env.SPIKE_MODE!=='baseline') args.push('--import',pathToFileURL(path.join(here,'register.mjs')).href);
args.push(path.join(here,'server-entry.mjs'),'--config',config);
const child=spawn(process.execPath,args,{cwd:path.resolve(here,'../..'),env:{...process.env,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});
let log='';
child.stdout.on('data',d=>log+=d);
child.stderr.on('data',d=>log+=d);
const closed=new Promise(resolve=>child.on('close',resolve));
const base=`http://127.0.0.1:${port}`;
try{
  const deadline=Date.now()+90000;
  for(;;){
    if(child.exitCode!==null) throw new Error(log);
    try{if((await fetch(base+'/health')).ok && log.includes('[pi] session '))break;}catch{}
    if(Date.now()>deadline)throw new Error(`startup deadline: ${log}`);
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal((await fetch(base+'/branding')).status,401);
  assert.equal((await fetch(base+'/branding',{headers:{Authorization:`Bearer ${token}`}})).status,200);
  assert.equal((await(await fetch(base+'/health')).json()).sessionId,undefined);
  const client=connect(`ws://127.0.0.1:${port}/ws?token=${token}`);
  try{assert.ok((await client.waitFor('hello',15000)).sessionId);}finally{client.close();}
  const denied=connect(`ws://127.0.0.1:${port}/ws?token=wrong`);
  assert.equal(await denied.waitForClose(),4401);
  assert.deepEqual(denied.received,[]);
  console.log('real-child HTTP/WS assertions passed');
}finally{
  child.stdin.end();
  let timer;
  const code=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve('timeout');},10000);})]);
  clearTimeout(timer);
  const resolvedRoot=await realpath(root);
  const resolvedTemp=await realpath(tmpdir());
  assert.equal(path.dirname(resolvedRoot),resolvedTemp,'cleanup must stay in the OS temporary directory');
  assert.ok(path.basename(resolvedRoot).startsWith('pi-outpost-test-'),'cleanup must target the workspace this test created');
  await rm(resolvedRoot,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  assert.equal(code,0,log);
}
