import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrument } from './instrument.mjs';
import { trialScope } from './trial-scope.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root:path.resolve(here,'../../ui'),
  plugins:[{name:'trial-source-istanbul',enforce:'pre',transform(source,id){
    if(id.includes('?')||!['ui','shared'].includes(trialScope(id)?.name))return;
    const result=instrument(source,path.resolve(id));
    return {code:result.code,map:result.map};
  }}],
  test:{environment:'jsdom',include:['src/**/*.test.{ts,tsx}'],
    setupFiles:[path.resolve(here,'../../ui/src/test-setup.ts'),path.join(here,'trial-ui-capture.mjs')],
    coverage:{enabled:false}},
});
