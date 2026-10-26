/**
 * Writes the generated diagrams of e2e/fixtures/drawio-routes-corpus.ts to files, to look at a
 * case or feed it to the other route probes.
 *
 *   npx tsx scripts/probes/drawio-routes-corpus.mts <out-dir> [files] [seed]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { corpus } from "../../e2e/fixtures/drawio-routes-corpus.ts";

const [dir, files = "40", seed = "1"] = process.argv.slice(2);
await fs.mkdir(dir!, { recursive: true });
const written = corpus(Number(files), Number(seed));
await Promise.all(written.map((xml, index) => fs.writeFile(path.join(dir!, `generated-${index}.drawio`), xml)));
console.log(`${written.length} diagrams in ${dir}`);
