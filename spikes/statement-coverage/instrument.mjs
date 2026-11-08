import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
const { createInstrumenter } = createRequire(import.meta.url)('istanbul-lib-instrument');

export function instrument(source, filename) {
  const tool = createInstrumenter({ esModules: true, compact: false,
    parserPlugins: ['typescript', 'jsx'], produceSourceMap: true,
    coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
  const code = tool.instrumentSync(source, filename);
  return { code, map: tool.lastSourceMap(), coverage: tool.lastFileCoverage() };
}

export function executable(source, filename) {
  const measured = instrument(source, filename);
  const result = transformSync(measured.code, {
    loader: filename.endsWith('x') ? 'tsx' : /\.[cm]?ts$/.test(filename) ? 'ts' : 'js',
    format: 'esm', target: 'node24', jsx: 'automatic', sourcefile: filename,
    sourcemap: 'inline',
  });
  return { ...measured, code: result.code };
}
