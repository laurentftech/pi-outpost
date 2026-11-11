// Does a NODE_OPTIONS --import preload run in a worker thread, with its hooks and exit event?
// Run: NODE_OPTIONS=--import=./preload.mjs node main.mjs
import { Worker } from 'node:worker_threads';
const w = new Worker(new URL('./child.mjs', import.meta.url));
w.on('message', (m) => { console.log('main got', m); w.terminate(); });
w.on('exit', (code) => console.log('worker exited', code));
