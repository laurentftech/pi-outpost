// Instrumented code, cached on disk for the length of one trial.
//
// Every server process the suites start loads server/src, shared/src and office/src, and the
// hook instruments each file it loads: Istanbul, then esbuild. Done again in each of hundreds
// of processes, that put seconds on every server start — enough to push startup past the 10 s
// the update-check test allows, with the check never involved. The result depends only on the
// file's path and content and on the instrumenter, so it is computed once: `warm` fills the
// cache before the suites, and a process finding no entry writes it, atomically, for the next.
import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,renameSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { executable } from './instrument.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
// The instrumenter's own source is part of the key, so a change to it never serves stale code.
const INSTRUMENTER=createHash('sha256').update(readFileSync(path.join(here,'instrument.mjs'))).digest('hex');

export function cacheKey(file,source){
  return createHash('sha256').update(INSTRUMENTER).update('\0').update(file).update('\0').update(source).digest('hex');
}

/** The executable instrumented code for `file`, from the trial's cache or computed and stored there. */
export function cachedExecutable(dir,file){
  const source=readFileSync(file,'utf8');
  const entry=path.join(dir,'instrumented',`${cacheKey(file,source)}.js`);
  try{return readFileSync(entry,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const {code}=executable(source,file);
  mkdirSync(path.dirname(entry),{recursive:true});
  // Concurrent processes may compute the same entry: each writes its own file, then renames.
  const temporary=`${entry}.${process.pid}-${threadId}.tmp`;
  writeFileSync(temporary,code);
  renameSync(temporary,entry);
  return code;
}

/** Instrument every file in advance, so no suite pays for it on a server's startup path. */
export function warm(dir,files){
  for(const file of files)cachedExecutable(dir,file);
}
