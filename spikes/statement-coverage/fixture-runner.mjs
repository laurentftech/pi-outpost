import assert from 'node:assert/strict';
import { choose, interrupted, childOnly } from './fixture.ts';
if (process.argv.includes('child')) {
  assert.equal(choose(false), -1);
  assert.equal(childOnly(), 7);
} else {
  assert.equal(choose(true), 3);
  assert.throws(interrupted, /expected/);
}
