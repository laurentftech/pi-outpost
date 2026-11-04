import { spawn } from "node:child_process";
const results = await Promise.all(Array.from({ length: 4 }, async (_, worker) => {
  for (let i = 0; i < 8; i++) {
    console.log(`Worker ${worker} attempt ${i}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx/esm", "--test", "--test-name-pattern=while a tool runs", "--test-timeout=120000", "server/test/queuedPromptsWire.test.mjs"], { stdio: "inherit" });
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) return false;
  }
  return true;
}));
if (results.some((passed) => !passed)) process.exitCode = 1;
