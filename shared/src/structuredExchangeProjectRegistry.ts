/**
 * A project's structured-exchange registry, profiles and rules, read from its own files.
 *
 * Shared by the server — which reads it on every tool call — and the reference validator,
 * which reads it outside any server to validate a specification in batch. One reader, so
 * the agent's tools and the validator can never disagree about what a project declares.
 *
 * Read on every call rather than cached: the files are small, and a cache would bring
 * back the question of which version of a profile a verdict was reached under — the
 * one question a reviewer must never have to ask.
 *
 * SECURITY: every file is resolved to a real path and must stay inside the project
 * directory — including through a symbolic link. Nothing is fetched; a registry lists
 * paths, never addresses.
 *
 * Three answers, never a fourth: no registry, a usable one, or an unusable one with
 * every reason and the file each is about. There is no "partly usable" — a registry
 * the project wrote and got wrong must not quietly mean "unconstrained".
 *
 * Node-only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  STRUCTURED_EXCHANGE_PROFILE_CEILINGS,
  STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH,
  STRUCTURED_EXCHANGE_RULES_CEILINGS,
  type ProfileRule,
  type StructuredExchangeProfile,
} from "./structuredExchangeProfile.ts";
import type { ProfileContext } from "./structuredExchangeProfileCheck.ts";
import {
  registryConsistencyIssues,
  validateProfile,
  validateRegistry,
  type LoadedProfile,
} from "./structuredExchangeProfileValidation.ts";
import { registryRulesIssues, rulesAgainstProfile, validateRules, type LoadedRules } from "./structuredExchangeRulesValidation.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

/** An issue, and the project file it is about — relative to the project, as the registry names files. */
export type ProjectProfileIssue = StructuredExchangeIssue & { file: string };

/** A file the registry made use of, relative to the project, with its bytes' digest. */
export interface RegistryFile {
  path: string;
  sha256: string;
}

export type ProjectProfiles =
  | { state: "none" }
  | {
      state: "usable";
      context: ProfileContext;
      /** The profile and rules files read, in the registry's order — what a report is checked against. */
      files: RegistryFile[];
    }
  | { state: "unusable"; issues: ProjectProfileIssue[] };

type FileRead = { ok: true; value: unknown; sha256: string } | { ok: false; issue: StructuredExchangeIssue } | { ok: "missing" };

/**
 * The real path of `target`, or of its deepest existing ancestor with the rest appended.
 * The same resolution the server's sandbox applies, so a link cannot walk a path out of
 * the project and a path that does not exist yet is still judged.
 */
async function realResolve(target: string): Promise<string> {
  let existing = target;
  let tail = "";
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return tail ? path.join(real, tail) : real;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target;
      tail = tail ? path.join(path.basename(existing), tail) : path.basename(existing);
      existing = parent;
    }
  }
}

const isWithin = (root: string, target: string): boolean => target === root || target.startsWith(root + path.sep);

function digestOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Reads one confined JSON file, bounded before it is parsed. */
async function readConfinedJson(root: string, relative: string, maxBytes: number, namespace: string): Promise<FileRead> {
  const resolved = await realResolve(path.resolve(root, relative));
  if (path.isAbsolute(relative) || !isWithin(root, resolved)) {
    return {
      ok: false,
      issue: { rule: `${namespace}/outside-project`, path: "", message: `"${relative}" is outside the project directory` },
    };
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat === null) return { ok: "missing" };
  if (!stat.isFile()) {
    return { ok: false, issue: { rule: `${namespace}/not-a-file`, path: "", message: `"${relative}" is not a file` } };
  }
  if (stat.size > maxBytes) {
    return {
      ok: false,
      issue: {
        rule: `${namespace}/too-large`,
        path: "",
        message: `"${relative}" is ${stat.size} bytes, past the ${maxBytes}-byte limit`,
        limit: maxBytes,
        observed: stat.size,
        level: "ceiling",
      },
    };
  }
  let text: string;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch (error) {
    // Removed between the measurement and the read: the same answer as never there.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: "missing" };
    return { ok: false, issue: { rule: `${namespace}/unreadable`, path: "", message: `"${relative}" cannot be read: ${(error as Error).message}` } };
  }
  try {
    return { ok: true, value: JSON.parse(text), sha256: digestOf(text) };
  } catch (error) {
    return { ok: false, issue: { rule: `${namespace}/not-json`, path: "", message: `"${relative}" is not JSON: ${(error as Error).message}` } };
  }
}

/**
 * The profiles and rules the project at `projectRoot` declares.
 *
 * Resolved to a real path first: the confinement comparison is between real paths, and on
 * macOS a project under /tmp is reached through a link. `registryPath` is relative to the
 * project; it defaults to where a project keeps its registry.
 */
export async function readProjectRegistry(
  projectRoot: string,
  registryPath: string = STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH,
): Promise<ProjectProfiles> {
  // Through the deepest existing ancestor, so a project directory that does not exist is
  // still compared as a real path — and reads as no registry, not as one outside it.
  const root = await realResolve(path.resolve(projectRoot));
  const registryFile = registryPath;
  const registryRead = await readConfinedJson(root, registryFile, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.registryBytes, "registry");
  if (registryRead.ok === "missing") return { state: "none" };
  if (registryRead.ok === false) return { state: "unusable", issues: [{ ...registryRead.issue, file: registryFile }] };

  const registryVerdict = validateRegistry(registryRead.value);
  if (!registryVerdict.valid) {
    return { state: "unusable", issues: registryVerdict.issues.map((issue) => ({ ...issue, file: registryFile })) };
  }
  const registry = registryVerdict.registry;
  const files: RegistryFile[] = [];

  // Every listed file, not the first bad one: an author fixing a registry of five
  // profiles should learn about all of them from one refusal.
  const issues: ProjectProfileIssue[] = [];
  const loaded: LoadedProfile[] = [];
  for (const [index, listed] of registry.profiles.entries()) {
    const read = await readConfinedJson(root, listed, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profileBytes, "profile-format");
    if (read.ok === "missing") {
      issues.push({ rule: "registry/missing-profile", path: `/profiles/${index}`, message: `"${listed}" does not exist`, file: registryFile });
      continue;
    }
    if (read.ok === false) {
      // Leaving the project is the registry's fault, whatever the file would contain.
      issues.push(
        read.issue.rule === "profile-format/outside-project"
          ? { ...read.issue, rule: "registry/profile-outside-project", path: `/profiles/${index}`, file: registryFile }
          : { ...read.issue, file: listed },
      );
      continue;
    }
    const verdict = validateProfile(read.value);
    if (!verdict.valid) {
      issues.push(...verdict.issues.map((issue) => ({ ...issue, file: listed })));
      continue;
    }
    loaded.push({ path: listed, profile: verdict.profile });
    files.push({ path: listed, sha256: read.sha256 });
  }
  // Consistency needs every profile, in the registry's order; judging it over a
  // partial set would report a default "unregistered" because its file was broken.
  if (issues.length > 0) return { state: "unusable", issues };

  const consistency = registryConsistencyIssues(registry, loaded);
  if (consistency.length > 0) return { state: "unusable", issues: consistency.map((issue) => ({ ...issue, file: registryFile })) };

  const profiles = new Map<string, StructuredExchangeProfile>(loaded.map((entry) => [entry.profile.id, entry.profile]));

  // Rules files, read like profiles and judged against the profile each names. A rule
  // that cannot fire because a value was renamed makes the registry unusable rather than
  // quietly checking nothing — the same answer a broken profile gets.
  const loadedRules: LoadedRules[] = [];
  for (const [index, listed] of (registry.rules ?? []).entries()) {
    const read = await readConfinedJson(root, listed, STRUCTURED_EXCHANGE_RULES_CEILINGS.rulesBytes, "rules-format");
    if (read.ok === "missing") {
      issues.push({ rule: "registry/missing-rules", path: `/rules/${index}`, message: `"${listed}" does not exist`, file: registryFile });
      continue;
    }
    if (read.ok === false) {
      issues.push(
        read.issue.rule === "rules-format/outside-project"
          ? { ...read.issue, rule: "registry/rules-outside-project", path: `/rules/${index}`, file: registryFile }
          : { ...read.issue, file: listed },
      );
      continue;
    }
    const verdict = validateRules(read.value);
    if (!verdict.valid) {
      issues.push(...verdict.issues.map((issue) => ({ ...issue, file: listed })));
      continue;
    }
    const profile = profiles.get(verdict.rules.profile);
    if (profile !== undefined) {
      issues.push(...rulesAgainstProfile(verdict.rules, profile).map((issue) => ({ ...issue, file: listed })));
    }
    loadedRules.push({ path: listed, rules: verdict.rules });
    files.push({ path: listed, sha256: read.sha256 });
  }
  // Only once every file read cleanly: a file for an unregistered profile, or a rule id
  // claimed twice, is judged over the whole set, and reported against the registry.
  if (issues.length === 0) {
    issues.push(...registryRulesIssues(loadedRules, profiles).map((issue) => ({ ...issue, file: registryFile })));
  }
  if (issues.length > 0) return { state: "unusable", issues };

  const rules = new Map<string, ProfileRule[]>();
  for (const entry of loadedRules) rules.set(entry.rules.profile, [...(rules.get(entry.rules.profile) ?? []), ...entry.rules.rules]);
  return {
    state: "usable",
    context: { profiles, ...(registry.default !== undefined ? { default: registry.default } : {}), ...(rules.size > 0 ? { rules } : {}) },
    files,
  };
}

/** An unusable registry, as the lines a refusal carries. */
export function describeUnusableProfiles(issues: readonly ProjectProfileIssue[]): string[] {
  return issues.map((issue) => `- ${issue.rule} in ${issue.file}${issue.path === "" ? "" : ` at ${issue.path}`}: ${issue.message}`);
}
