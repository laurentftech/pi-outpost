import '../../server/src/config.ts';
import { stopGraceMs } from '../../server/test/harness.mjs';
if(process.argv[2]==='fail')throw new Error('deliberate startup failure');
if(process.argv[2]==='normal')process.exit(0);
console.log(`READY ${stopGraceMs()}`);
setInterval(()=>{},1000);
