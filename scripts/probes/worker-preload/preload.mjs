import { isMainThread, threadId } from 'node:worker_threads';
import { registerHooks } from 'node:module';
console.log(`preload ran: main=${isMainThread} thread=${threadId} argv1=${process.argv[1]}`);
registerHooks({ load(url, context, next) { const r = next(url, context); if (url.endsWith('child.mjs')) console.log(`hook saw child.mjs in thread ${threadId}`); return r; } });
process.on('exit', () => console.log(`exit event in thread ${threadId}`));
