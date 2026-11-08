import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrument } from './instrument.mjs';
import { scopeOf } from '../../scripts/coverage-config.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const mode=process.env.SPIKE_MODE;
export default defineConfig({
  root:path.resolve(here,'../../ui'),
  plugins:mode==='istanbul'?[{
    name:'spike-original-source-istanbul',enforce:'pre',
    transform(source,id){
      if(id.includes('?') || !['ui','shared'].includes(scopeOf(id)?.name))return;
      const result=instrument(source,path.resolve(id));
      return {code:result.code,map:result.map};
    },
  }]:[],
  test:{
    environment:'jsdom',include:['src/**/*.test.{ts,tsx}'],
    setupFiles:[path.resolve(here,'../../ui/src/test-setup.ts'),path.join(here,'ui-capture.mjs')],
    coverage:mode==='v8'?{enabled:true,provider:'v8',allowExternal:true,
      include:['src/util/markdownMath.ts','../shared/src/markdownMath.ts'],
      reporter:['json','json-summary'],reportsDirectory:process.env.SPIKE_COVERAGE_DIR}:
      {enabled:false},
  },
});
