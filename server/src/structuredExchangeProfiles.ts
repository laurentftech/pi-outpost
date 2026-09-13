/**
 * A project's structured-exchange profiles, read from its own files.
 *
 * Read on every call rather than cached: the files are small, and a cache would bring
 * back the question of which version of a profile a verdict was reached under — the
 * one question a reviewer must never have to ask. An edited profile applies to the
 * next check, with nothing to restart.
 *
 * SECURITY: every file is resolved through `realResolve` and must stay inside the
 * workspace root — including through a symbolic link. Only the root: a sandbox's read
 * exceptions widen what the agent may read, not where a project's rules may come
 * from. Nothing is fetched; a registry lists paths, never addresses.
 *
 * Three answers, never a fourth: no registry, a usable one, or an unusable one with
 * every reason and the file each is about. There is no "partly usable" — a registry
 * the project wrote and got wrong must not quietly mean "unconstrained".
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  STRUCTURED_EXCHANGE_PROFILE_CEILINGS,
  STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH,
  type StructuredExchangeProfile,
} from "@pi-outpost/shared/structured-exchange/profile";
import type { ProfileContext } from "@pi-outpost/shared/structured-exchange/profile-check";
import {
  registryConsistencyIssues,
  validateProfile,
  validateRegistry,
  type LoadedProfile,
} from "@pi-outpost/shared/structured-exchange/profile-validation";
import type { StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/validation";
import { isWithin, realResolve } from "./sandbox.ts";

/** An issue, and the project file it is about — relative to the project, as the registry names files. */
export type ProjectProfileIssue = StructuredExchangeIssue & { file: string };

export type ProjectProfiles =
  | { state: "none" }
  | { state: "usable"; context: ProfileContext }
  | { state: "unusable"; issues: ProjectProfileIssue[] };

type FileRead = { ok: true; value: unknown } | { ok: false; issue: StructuredExchangeIssue } | { ok: "missing" };

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
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, issue: { rule: `${namespace}/not-json`, path: "", message: `"${relative}" is not JSON: ${(error as Error).message}` } };
  }
}

/**
 * The profiles the project at `root` declares.
 *
 * `root` is the workspace root as the server resolved it — a real path, as the
 * confinement comparison requires.
 */
export async function readProjectProfiles(root: string): Promise<ProjectProfiles> {
  const registryFile = STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH;
  const registryRead = await readConfinedJson(root, registryFile, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.registryBytes, "registry");
  if (registryRead.ok === "missing") return { state: "none" };
  if (registryRead.ok === false) return { state: "unusable", issues: [{ ...registryRead.issue, file: registryFile }] };

  const registryVerdict = validateRegistry(registryRead.value);
  if (!registryVerdict.valid) {
    return { state: "unusable", issues: registryVerdict.issues.map((issue) => ({ ...issue, file: registryFile })) };
  }
  const registry = registryVerdict.registry;

  // Every listed file, not the first bad one: an author fixing a registry of five
  // profiles should learn about all of them from one refusal.
  const issues: ProjectProfileIssue[] = [];
  const loaded: LoadedProfile[] = [];
  for (const [index, listed] of registry.profiles.entries()) {
    const read = await readConfinedJson(root, listed, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profileBytes, "profile-format");
    if (read.ok === "missing") {
      issues.push({
        rule: "registry/missing-profile",
        path: `/profiles/${index}`,
        message: `"${listed}" does not exist`,
        file: registryFile,
      });
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
  }
  // Consistency needs every profile, in the registry's order; judging it over a
  // partial set would report a default "unregistered" because its file was broken.
  if (issues.length > 0) return { state: "unusable", issues };

  const consistency = registryConsistencyIssues(registry, loaded);
  if (consistency.length > 0) return { state: "unusable", issues: consistency.map((issue) => ({ ...issue, file: registryFile })) };

  const profiles = new Map<string, StructuredExchangeProfile>(loaded.map((entry) => [entry.profile.id, entry.profile]));
  return { state: "usable", context: { profiles, ...(registry.default !== undefined ? { default: registry.default } : {}) } };
}

/** An unusable registry, as the lines a refusal carries. */
export function describeUnusableProfiles(issues: readonly ProjectProfileIssue[]): string[] {
  return issues.map((issue) => `- ${issue.rule} in ${issue.file}${issue.path === "" ? "" : ` at ${issue.path}`}: ${issue.message}`);
}
