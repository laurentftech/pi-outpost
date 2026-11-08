import { scopeOf,COVERAGE_EXCLUSIONS } from '../../scripts/coverage-config.mjs';
import path from 'node:path';
export const TRIAL_EXCLUSIONS=[...COVERAGE_EXCLUSIONS,{
  pattern:'server/src/embedded-web.ts',reason:'build-generated web bundle; handwritten UI sources are measured in ui/src instead',
}];
export function trialScope(file){
  const normalized=file.split(path.sep).join('/');
  if(normalized.endsWith('/server/src/embedded-web.ts'))return;
  return scopeOf(file);
}
