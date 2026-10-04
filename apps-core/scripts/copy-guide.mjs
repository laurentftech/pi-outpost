// Copies the structured-exchange skill's reference pages beside a bundled server, so the
// bundle serves the guide from <out>/guide/ (see src/guide.ts). The pages are not kept in
// any server package: the skill's files are the one source.
//
//     node ../apps-core/scripts/copy-guide.mjs dist
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2];
if (!out) throw new Error("usage: copy-guide.mjs <output directory>");
const from = fileURLToPath(new URL("../../skills/structured-exchange/references/", import.meta.url));
const to = path.resolve(out, "guide");
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from).filter((name) => name.endsWith(".md"))) copyFileSync(path.join(from, file), path.join(to, file));
