/**
 * `npm run dev` and `npm run dev:sandbox` run from an untracked copy of their committed
 * configuration, `pi-outpost.config.<name>.local.json`, beside it (so its relative paths mean
 * the same) and ignored by git.
 *
 * The server writes back to the file it was started with — the projects open, Settings applied —
 * and the committed file then showed the developer's own paths in `git status`, to be restored
 * by hand after every session and never to be committed.
 *
 * The copy is made when it is missing, and made again when the committed file is newer: a
 * change pulled from the repository wins over the copy's values for the same keys, while the
 * keys only the copy has (`openProjects`, …) are kept.
 *
 * Usage: node scripts/dev-config.mjs <name>   (dev, dev-sandbox)
 */
import { closeSync, constants, copyFileSync, fstatSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns what was done: "created", "refreshed" or "kept".
 *
 * Each file is checked through the descriptor it is then read or written through, never by name
 * first and opened after: what is compared is what is used.
 */
export function prepareDevConfig(committed, local) {
  try {
    copyFileSync(committed, local, constants.COPYFILE_EXCL);
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const committedFd = openSync(committed, "r");
  let base;
  let committedTime;
  try {
    committedTime = fstatSync(committedFd).mtimeMs;
    base = JSON.parse(readFileSync(committedFd, "utf8"));
  } finally {
    closeSync(committedFd);
  }
  const localFd = openSync(local, "r+");
  try {
    if (committedTime <= fstatSync(localFd).mtimeMs) return "kept";
    let mine = {};
    try {
      mine = JSON.parse(readFileSync(localFd, "utf8"));
    } catch {
      // An unreadable copy is replaced by the committed file, nothing kept.
    }
    const merged = { ...base };
    for (const [key, value] of Object.entries(mine)) if (!(key in base)) merged[key] = value;
    ftruncateSync(localFd, 0);
    writeSync(localFd, `${JSON.stringify(merged, null, 2)}
`, 0);
  } finally {
    closeSync(localFd);
  }
  return "refreshed";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name || !/^[\w-]+$/.test(name)) {
    console.error("usage: node scripts/dev-config.mjs <name>");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const committed = path.join(root, `pi-outpost.config.${name}.json`);
  const local = path.join(root, `pi-outpost.config.${name}.local.json`);
  const done = prepareDevConfig(committed, local);
  if (done !== "kept") console.log(`[dev] ${path.basename(local)} ${done} from ${path.basename(committed)}`);
}
