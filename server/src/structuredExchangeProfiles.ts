/**
 * A project's structured-exchange profiles, as the server reads them for its tools and
 * its readers.
 *
 * The reading itself lives in `shared` (`structured-exchange/project-registry`), where the
 * reference validator reads the same registry outside any server: one reader, so the
 * agent's tools and a batch validation never disagree about what a project declares.
 * What stays here is what only a server does — telling readers whether the documents
 * they were shown conform, against the files as they are now.
 */
import { RESERVED_PROFILE_IDENTIFIERS, type StructuredConformance } from "@pi-outpost/shared/structured-exchange/profile";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { readProjectRegistry, type ProjectProfiles } from "@pi-outpost/shared/structured-exchange/project-registry";

export {
  describeUnusableProfiles,
  type ProjectProfileIssue,
  type ProjectProfiles,
} from "@pi-outpost/shared/structured-exchange/project-registry";

/** The profiles the project at `projectRoot` declares, read from its own files now. */
export function readProjectProfiles(projectRoot: string): Promise<ProjectProfiles> {
  return readProjectRegistry(projectRoot);
}

/**
 * What a reader is told about each presented document, against the project's registry
 * as it is now.
 *
 * Recomputed rather than recorded, deliberately: a profile tightened since a proposal
 * was made should make that proposal say "no longer conforms" to the person about to
 * approve it. The registry is read once for the whole batch. A document the project
 * holds to no profile gets no statement; one that no longer passes the core contract
 * gets none either — the reader's own validation says what is wrong with it.
 */
export async function structuredConformanceFor(
  projectRoot: string,
  documents: readonly { toolCallId: string; structured: string }[],
): Promise<{ toolCallId: string; conformance: StructuredConformance }[]> {
  if (documents.length === 0) return [];
  const project = await readProjectProfiles(projectRoot);
  if (project.state === "none") return [];
  const statements: { toolCallId: string; conformance: StructuredConformance }[] = [];
  for (const { toolCallId, structured } of documents) {
    const verdict = parseSerializedStructuredExchange(structured, checkStructuredExchangeSchema);
    if (!verdict.valid) continue;
    const named = (verdict.envelope as { profile?: unknown }).profile;
    // A report or a view of the project's rules is never held to a profile, so nothing is
    // said about it — not even that it could not be checked while the registry is broken.
    if (typeof named === "string" && RESERVED_PROFILE_IDENTIFIERS.has(named)) continue;
    const namedProfile = typeof named === "string" ? { profile: named } : {};
    if (project.state === "unusable") {
      statements.push({ toolCallId, conformance: { state: "unchecked", openValues: 0, ...namedProfile } });
      continue;
    }
    const held = holdToProfile(verdict.envelope, project.context);
    if (held.outcome === "unconstrained") continue;
    if (held.outcome === "conforms") {
      const findings = held.findings?.length ?? 0;
      statements.push({
        toolCallId,
        conformance: { profile: held.profile, state: "conforms", openValues: held.notes.length, ...(findings === 0 ? {} : { findings }) },
      });
      continue;
    }
    const profile = held.profile ?? (typeof named === "string" ? named : project.context.default);
    statements.push({ toolCallId, conformance: { state: "strays", openValues: 0, ...(profile === undefined ? {} : { profile }) } });
  }
  return statements;
}
