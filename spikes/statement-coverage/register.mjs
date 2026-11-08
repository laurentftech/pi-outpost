// Experimental only: explicitly loaded by the spike runner, never the app or CI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executable } from './instrument.mjs';

const directory = process.env.SPIKE_COVERAGE_DIR;
const mode = process.env.SPIKE_MODE;
if (!directory || !['istanbul', 'v8'].includes(mode)) throw new Error('Explicit spike output and mode required');
const includes = JSON.parse(process.env.SPIKE_INCLUDE ?? '[]').map(p => path.resolve(p));
const sources = {};
const keep = file => includes.some(p => file === p || file.startsWith(p + path.sep));
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith('file:') || result.source == null) return result;
    const file = fileURLToPath(url);
    if (!keep(file) || file.includes(`${path.sep}node_modules${path.sep}`)) return result;
    if (mode === 'v8') {
      sources[url] = String(result.source);
      return result;
    }
    return { ...result, format: 'module', source: executable(readFileSync(file, 'utf8'), file).code };
  },
});
process.on('exit', () => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `spike-${mode}-${process.pid}.json`), JSON.stringify(
    mode === 'istanbul' ? globalThis.__coverage__ ?? {} : { sources }));
});
