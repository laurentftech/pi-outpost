import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import coverageLib from 'istanbul-lib-coverage';

export function writeJson(file,value){
  mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify(value));
  renameSync(temporary,file);
}
export function startProcess(dir,id,entry,details={}){
  writeJson(path.join(dir,'expected',`${id}.json`),{id,entry,...details});
}
export function dump(dir,id,coverage){
  const files=[];
  mkdirSync(path.join(dir,'metadata'),{recursive:true});
  for(const c of Object.values(coverage)){
    const metadata={path:path.resolve(c.path),statementMap:c.statementMap,fnMap:c.fnMap,branchMap:c.branchMap};
    const hash=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
    const file=path.join(dir,'metadata',`${hash}.json`);
    try{writeFileSync(file,JSON.stringify(metadata),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    files.push({metadata:hash,s:c.s,f:c.f,b:c.b});
  }
  writeJson(path.join(dir,'dumps',`${id}.json`),{id,files});
}
export function collect(dir){
  const map=coverageLib.createCoverageMap({});
  const missing=[];
  const expectedDir=path.join(dir,'expected');
  const expected=existsSync(expectedDir)?readdirSync(expectedDir).filter(n=>n.endsWith('.json')):[];
  for(const name of expected){
    const marker=JSON.parse(readFileSync(path.join(expectedDir,name),'utf8'));
    const dumpFile=path.join(dir,'dumps',name);
    if(!existsSync(dumpFile)){missing.push(marker);continue;}
    const data=JSON.parse(readFileSync(dumpFile,'utf8'));
    if(data.files.length===0){missing.push({...marker,reason:'empty dump'});continue;}
    for(const c of data.files){
      const metadata=JSON.parse(readFileSync(path.join(dir,'metadata',`${c.metadata}.json`),'utf8'));
      map.addFileCoverage({...metadata,s:c.s,f:c.f,b:c.b});
    }
  }
  return {map,missing,processes:expected.length};
}
