/**
 * The structured-exchange guide, read by Open WebUI's models through a tool.
 *
 * The pages are pi-outpost's own: the reference pages of its `structured-exchange`
 * skill, read from the same files, so a page improved once improves both hosts. The
 * few passages that concern only pi-outpost's tools sit between
 * `<!-- only: pi-outpost -->` and `<!-- end -->` in the source, and are left out
 * here — nothing else is changed. From source the pages are read where the skill
 * keeps them; the bundled server reads the copies its build puts in `dist/guide/`.
 *
 * Why a tool and not an Open WebUI skill: a skill is one text an admin imports and
 * grants, per deployment, and the imported copy no longer follows the server. A tool
 * ships with the server and is always the server's version — and a refusal can name
 * the page that would have helped (see `guideTopicFor`).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/parse";

export interface GuideTopic {
  topic: string;
  file: string;
  purpose: string;
}

export const GUIDE_TOPICS: readonly GuideTopic[] = [
  {
    topic: "graphs-and-tables",
    file: "graphs-and-tables.md",
    purpose: "group elements in containers, mark what a change did to a table's rows, declare viewpoints",
  },
  {
    topic: "proposals",
    file: "proposals.md",
    purpose: "propose a change to something that already exists: target, ref, set, removals",
  },
  {
    topic: "timelines",
    file: "timelines.md",
    purpose: "plans, schedules, roadmaps, Gantt charts: rows, activities, milestones, dependencies, closures",
  },
  {
    topic: "enriched",
    file: "enriched-contract.md",
    purpose:
      "version 2: attributes, expectations, locations, artifact links, requirements tables with headings and traceability",
  },
];

const PAGE_DIRECTORIES = [
  // The bundled server: dist/server.mjs, beside dist/guide/.
  new URL("./guide/", import.meta.url),
  // From source: apps-core/src/guide.ts, two levels below the repository root.
  new URL("../../skills/structured-exchange/references/", import.meta.url),
];

const BEGIN = /^\s*<!-- only: pi-outpost -->\s*$/;
const END = /^\s*<!-- end -->\s*$/;

/** The page without its pi-outpost-only passages, markers included. Nothing else changes. */
export function withoutPiOnlyPassages(source: string): string {
  const kept: string[] = [];
  let skipping = false;
  // Split keeping each line's own ending, so what is kept is byte for byte the source.
  for (const line of source.split(/(?<=\n)/)) {
    if (!skipping && BEGIN.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (END.test(line)) skipping = false;
      continue;
    }
    kept.push(line);
  }
  if (skipping) throw new Error("a pi-outpost-only passage is never closed with <!-- end -->");
  return kept.join("");
}

const pages = new Map<string, string>();

/** The source of a page, from wherever this server runs. */
export function pageSource(file: string): string {
  for (const directory of PAGE_DIRECTORIES) {
    try {
      return fs.readFileSync(fileURLToPath(new URL(file, directory)), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`guide page ${file} is missing: build the server (npm run build:server)`);
}

export function guidePage(topic: string): string | undefined {
  const entry = GUIDE_TOPICS.find((candidate) => candidate.topic === topic);
  if (!entry) return undefined;
  let page = pages.get(entry.topic);
  if (page === undefined) {
    page = withoutPiOnlyPassages(pageSource(entry.file));
    pages.set(entry.topic, page);
  }
  return page;
}

const PROPOSAL_RULES = new Set([
  "change-without-target",
  "change-without-reference",
  "removal-without-target",
  "kind-not-proposable",
  "duplicate-reference",
]);

/**
 * The page that covers what was broken, for a refused document.
 *
 * Read from the document's kind and version and the issues' rules and paths; the
 * issues themselves are never changed. A timeline goes to the timelines page whatever
 * it broke — that page also says why a timeline cannot be a proposal.
 */
export function guideTopicFor(document: unknown, issues: readonly StructuredExchangeIssue[]): string {
  let parsed: { kind?: unknown; schema?: unknown } | undefined;
  try {
    parsed = (typeof document === "string" ? JSON.parse(document) : document) as typeof parsed;
  } catch {
    parsed = undefined;
  }
  // An envelope written inside `data` still says what the document meant to be, and the
  // page for that is the one to read once the envelope is moved: a timeline sent to the
  // graphs page would be fixed into a graph.
  const data = (parsed as { data?: { kind?: unknown; schema?: unknown } } | undefined)?.data;
  if (parsed !== undefined && parsed !== null && typeof data === "object" && data !== null) {
    parsed = { ...parsed, kind: parsed.kind ?? data.kind, schema: parsed.schema ?? data.schema };
  }
  if (parsed?.kind === "timeline") return "timelines";
  // A table cannot be a proposal. What a change did to a table is said with row roles,
  // which the graphs-and-tables page teaches; sending the model to the proposals page
  // had it retry a table proposal four times before giving up (live run, 2026-10-04).
  if (parsed?.kind === "table" && issues.some((issue) => issue.rule === "kind-not-proposable")) return "graphs-and-tables";
  const proposal = issues.some(
    (issue) =>
      PROPOSAL_RULES.has(issue.rule) ||
      issue.path.startsWith("/removals") ||
      issue.path.startsWith("/target") ||
      /\/set(\/|$)/.test(issue.path),
  );
  if (proposal) return "proposals";
  if (parsed?.schema === "urn:structured-exchange:2") return "enriched";
  return "graphs-and-tables";
}
