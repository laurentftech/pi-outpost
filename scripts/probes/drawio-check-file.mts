/**
 * drawio_check's report for files on disk, as the agent reads it.
 *
 *   npx tsx scripts/probes/drawio-check-file.mts <file.drawio> [...]
 */
import fs from "node:fs/promises";
import { checkDrawio, describeDrawioReport } from "../../server/src/drawio.ts";

for (const file of process.argv.slice(2)) console.log(describeDrawioReport(file, checkDrawio(await fs.readFile(file, "utf8"))), "\n");
