import { afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startProcess,dump } from './trial-store.mjs';
const dir=process.env.SPIKE_TRIAL_DIR;
const id=`ui-${process.pid}-${randomUUID()}`;
// Only files whose suites actually loaded instrumented production code need a dump.
afterAll(()=>{
  const coverage=globalThis.__coverage__??{};
  if(Object.keys(coverage).length===0)return;
  startProcess(dir,id,'Vitest suite');
  dump(dir,id,coverage);
});
