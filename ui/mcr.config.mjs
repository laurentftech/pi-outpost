/**
 * monocart-coverage-reports options for the UI suites (`npm run test:coverage`), read by
 * vitest-monocart-coverage.
 *
 * The UI's tests run code in `ui/src` and in `shared/src`, which the server runs too. Both
 * are kept, as MCR raw data with paths relative to the repository root — the form
 * scripts/coverage-report.mjs merges with the server suites', so a shared file counts every
 * suite that runs it. The figures and thresholds come from that report.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoSourcePath, scopeOf } from "../scripts/coverage-config.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Whether a file (absolute, or relative as Vite names it) is in the UI or shared scope. */
const measured = (file) => ["ui", "shared"].includes(scopeOf(path.resolve(REPO, repoSourcePath(file)))?.name);

/** A V8 entry's URL as a path, when it is a file URL. */
const fromUrl = (url) => {
  try {
    return url.startsWith("file:") ? fileURLToPath(url) : url;
  } catch {
    return url;
  }
};

export default {
  name: "UI suites",
  outputDir: "coverage",
  baseDir: REPO,
  reports: ["raw", "console-summary"],
  cleanCache: true,
  entryFilter: (entry) => typeof entry.url === "string" && measured(fromUrl(entry.url)),
  sourceFilter: measured,
};
