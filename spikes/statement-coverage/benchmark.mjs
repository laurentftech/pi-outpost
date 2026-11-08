import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import coverageLib from 'istanbul-lib-coverage';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.join(here,'results',`benchmark-${Date.now()}`);
mkdirSync(out,{recursive:true});
const hook=pathToFileURL(path.join(here,'register.mjs')).href;
const includes=['server/src','shared/src'].map(p=>path.join(root,p));
const modes=['baseline','v8','istanbul'];
const report={commit:'aaa029434f42fc31b6818c2c51498171f2c27b41',outputDirectory:path.relative(root,out),node:process.version,platform:process.platform,cpu:os.cpus()[0].model,rounds:[]};
const rounds=Number(process.env.SPIKE_ROUNDS??3);
const only=process.argv[2];
for(let round=0;round<rounds;round++){
  for(const mode of [...modes.slice(round%modes.length),...modes.slice(0,round%modes.length)]){
    for(const suite of only?[only]:['server-unit','real-server-child','ui']){
      const dir=path.join(out,`${suite}-${mode}-${round}`);
      mkdirSync(dir,{recursive:true});
      const env={...process.env,SPIKE_MODE:mode,SPIKE_INCLUDE:JSON.stringify(includes),SPIKE_COVERAGE_DIR:dir,NODE_V8_COVERAGE:mode==='v8'&&suite!=='ui'?dir:''};
      let args;
      if(suite==='ui')args=[path.join(root,'node_modules/vitest/vitest.mjs'),'run','--config',path.join(here,'vitest.spike.config.mts'),'src/util/markdownMath.test.ts'];
      else if(suite==='real-server-child')args=[path.join(here,'integration-case.mjs')];
      else args=['--import','tsx/esm',...(mode==='baseline'?[]:['--import',hook]),'--test','server/test/config.test.ts','server/test/serverTransport.test.ts'];
      const start=performance.now();
      const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:16*1024*1024});
      const ms=performance.now()-start;
      writeFileSync(path.join(dir,'run.log'),result.stdout+'\n'+result.stderr);
      assert.equal(result.status,0,`${suite}/${mode}: ${result.error??''}\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-5000)}`);
      const row={round,suite,mode,ms};
      if(mode==='istanbul'){
        const map=coverageLib.createCoverageMap({});
        for(const name of readdirSync(dir).filter(n=>(n.startsWith('spike-istanbul-')||n.startsWith('ui-'))&&n.endsWith('.json')))map.merge(JSON.parse(readFileSync(path.join(dir,name),'utf8')));
        row.files=map.files().length;
        row.summary=map.getCoverageSummary().toJSON();
        if(suite==='real-server-child'){
          const index=map.files().find(f=>f===path.join(root,'server/src/index.ts'));
          assert.ok(index,'actual child index.ts must be measured');
          assert.ok(map.fileCoverageFor(index).toSummary().statements.covered>0);
        }
        if(suite==='ui')assert.ok(map.files().includes(path.join(root,'shared/src/markdownMath.ts')),'UI must credit the shared production source');
        writeFileSync(path.join(dir,'merged.json'),JSON.stringify(map.toJSON()));
      }
      report.rounds.push(row);
      writeFileSync(path.join(here,'results',`benchmark${only?'-'+only:''}.json`),JSON.stringify(report,null,2));
      console.log(JSON.stringify(row));
    }
  }
}
