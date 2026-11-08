// The experimental integration driver owns stdin; EOF permits an exit dump on Windows.
// Production CI uses Linux's graceful shutdown. No app endpoint is added for coverage.
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
await import('../../server/src/index.ts');
