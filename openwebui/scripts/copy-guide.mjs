// Copies the structured-exchange skill's reference pages beside the bundled server, so
// dist/server.mjs serves the guide from dist/guide/ (see src/guide.ts). The pages are
// not kept in openwebui/: the skill's files are the one source.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../skills/structured-exchange/references/", import.meta.url));
const to = fileURLToPath(new URL("../dist/guide/", import.meta.url));
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from).filter((name) => name.endsWith(".md"))) copyFileSync(path.join(from, file), path.join(to, file));
