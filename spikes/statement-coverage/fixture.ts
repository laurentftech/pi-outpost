import type { Stats } from 'node:fs';
interface Erased { value: Stats }
type AlsoErased = string;
// Deliberately two instructions on one source line.
export function choose(flag: boolean) {
  const a = 1; const b = 2;
  if (flag) return a + b;
  return a - b;
}
export function interrupted() {
  fail();
  return 'unreachable';
}
function fail() { throw new Error('expected'); }
export function never() { return 99; }
export function childOnly() { const n = 7; return n; }
