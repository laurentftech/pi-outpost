import '../../server/src/config.ts';
import { COVERAGE_STOP_GRACE_MS } from '../../server/test/harness.mjs';
if(process.argv[2]==='fail')throw new Error('deliberate startup failure');
if(process.argv[2]==='normal')process.exit(0);
console.log(`READY ${COVERAGE_STOP_GRACE_MS}`);
setInterval(()=>{},1000);
