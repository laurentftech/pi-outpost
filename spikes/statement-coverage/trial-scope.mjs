import { scopeOf,repoRelative,COVERAGE_EXCLUSIONS } from '../../scripts/coverage-config.mjs';
import path from 'node:path';
export const TRIAL_EXCLUSIONS=[...COVERAGE_EXCLUSIONS,{
  pattern:'server/src/embedded-web.ts',reason:'build-generated web bundle; handwritten UI sources are measured in ui/src instead',
}];
// Scopes this trial measures beyond the line-coverage pipeline's (scripts/coverage-config.mjs),
// whose thresholds and CI gate it leaves untouched. office/src holds the parsers and builders of
// Office documents, credited by its own suite and by every server suite that loads it.
const TRIAL_ONLY_SCOPES=[{name:'office',root:'office/src'}];
export const TRIAL_SCOPE_NAMES=['server','shared','ui',...TRIAL_ONLY_SCOPES.map(s=>s.name)];
const CODE=/\.(?:[cm]?js|[cm]?ts|tsx)$/;
export function trialScope(file){
  const normalized=file.split(path.sep).join('/');
  if(normalized.endsWith('/server/src/embedded-web.ts'))return;
  const scope=scopeOf(file);
  if(scope)return scope;
  const relative=repoRelative(file);
  if(relative===undefined||!CODE.test(relative))return;
  if(COVERAGE_EXCLUSIONS.some(({pattern})=>path.posix.matchesGlob(relative,pattern)))return;
  return TRIAL_ONLY_SCOPES.find(({root})=>relative.startsWith(`${root}/`));
}
