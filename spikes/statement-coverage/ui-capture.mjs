import { afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
afterAll(() => {
  if (process.env.SPIKE_MODE !== 'istanbul') return;
  const dir=process.env.SPIKE_COVERAGE_DIR;
  mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,`ui-${process.pid}-${randomUUID()}.json`),JSON.stringify(globalThis.__coverage__ ?? {}));
});
