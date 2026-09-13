/**
 * A figure produced from a document, by a caller with no browser.
 *
 * The gate and the drawing, in the order they have to happen: a document that
 * fails validation yields no figure at all, and the reason it failed is the
 * answer. There is no partial success here for the same reason there is none in
 * the validator — a figure drawn from half a document is a picture somebody will
 * act on.
 *
 * The refusals are separate values rather than one error string because they are
 * different situations for whoever asked. Not a structured-exchange document at
 * all, a version this build does not implement, a document that claims the
 * contract and fails it, a table (which is data, and has no figure), and a
 * narrowing that selected nothing — the last of which looks like success right up
 * until someone opens the file.
 */
import {
  readStructuredExchangeDocument,
  type NotADocument,
  type StructuredExchangeDocumentVerdict,
} from "./structuredExchangeDocument.ts";
import type { StructuredExchangeSchemaCheck } from "./structuredExchangeParse.ts";
import type { StructuredExchangeLimits } from "./structuredExchangeBounds.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";
import type {
  StructuredGraphData,
  StructuredSequenceData,
  StructuredViewpoint,
  ValidatedStructuredExchange,
} from "./structuredExchange.ts";
import { graphFigure, sequenceFigure, serializeFigure, shownGraph } from "./structuredExchangeFigure.ts";
import { narrowingOf, NOTHING_HIDDEN, resolveViewpoint, viewpointsOf, type Narrowing } from "./structuredExchangeModel.ts";

/** How much of the document the figure draws, in the document's own terms. */
export interface FigureCoverage {
  /** What the figure draws. */
  elements: number;
  relationships: number;
  /** What the document declares. */
  ofElements: number;
  ofRelationships: number;
}

export interface FigureExport {
  ok: true;
  /** One complete SVG document, self-contained. */
  svg: string;
  coverage: FigureCoverage;
  /**
   * The sentence the figure carries about how much of its document it shows.
   * Undefined when it shows all of it — there is then nothing to say.
   */
  narrowing?: string;
  /**
   * The viewpoint the figure was drawn for, when one was named, and who declared it:
   * the document, or the profile the document is held to.
   */
  viewpoint?: { id: string; label: string; source: "document" | "profile"; profile?: string };
}

export type FigureRefusal = { ok: false } & (
  | { reason: "not-a-document"; why: NotADocument }
  | { reason: "unsupported-version"; schema: string }
  | { reason: "invalid"; issues: StructuredExchangeIssue[] }
  | { reason: "too-large"; issue: StructuredExchangeIssue }
  /** A table is data. It exports as a spreadsheet, and has no figure. */
  | { reason: "not-drawable"; kind: string }
  /** The narrowing selected nothing, or the document declares nothing. */
  | { reason: "nothing-to-draw"; coverage: FigureCoverage }
  /** A viewpoint was named, and neither the document nor its profile declares any. */
  | { reason: "no-viewpoints"; viewpoint: string; profile?: string }
  /**
   * A viewpoint was named that neither declares; `declared` is what the document does,
   * `profileDeclared` what its profile does, when it is held to one.
   */
  | { reason: "unknown-viewpoint"; viewpoint: string; declared: string[]; profile?: string; profileDeclared?: string[] }
  /**
   * A profile's viewpoint none of whose kinds occur in this document. A document's own
   * viewpoint cannot be this — validation refuses it — but a profile's is written for
   * every document, so the question is only answerable here.
   */
  | { reason: "profile-viewpoint-absent"; viewpoint: string; profile: string }
);

/** What a caller names when it narrows: the reader's own vocabulary, as two lists. */
export interface FigureNarrowing {
  hiddenElementKinds?: readonly string[];
  hiddenRelationshipKinds?: readonly string[];
  /**
   * A viewpoint the document declares, by identifier. The figure is narrowed to it, and
   * any hidden kinds named beside it apply on top — the reader's key works the same way.
   */
  viewpoint?: string;
  /**
   * The profile the document is held to, when the caller holds one. Its viewpoints are
   * looked up after the document's own — the document is the more specific author.
   */
  profile?: { id: string; viewpoints: readonly StructuredViewpoint[] };
}

/** The refusal a document verdict maps to, or undefined when it validated. */
function refusalOf(verdict: StructuredExchangeDocumentVerdict): FigureRefusal | undefined {
  switch (verdict.status) {
    case "valid":
      return undefined;
    case "not-a-document":
      return { ok: false, reason: "not-a-document", why: verdict.why };
    case "unsupported-version":
      return { ok: false, reason: "unsupported-version", schema: verdict.schema };
    case "invalid":
      return { ok: false, reason: "invalid", issues: verdict.issues };
    case "too-large":
      return { ok: false, reason: "too-large", issue: verdict.issue };
  }
}

/**
 * A figure for a document that has already been validated.
 *
 * Separated from the text entry point below so a caller holding an envelope — the
 * browser, which validated it on the way in — does not validate it twice.
 */
export function figureForEnvelope(
  envelope: ValidatedStructuredExchange,
  narrowing: FigureNarrowing = {},
): FigureExport | FigureRefusal {
  const isProposal = envelope.target !== undefined;

  // Before anything is drawn, and for every kind: a viewpoint named for a document that
  // cannot have it is refused rather than ignored. Only a graph may declare viewpoints,
  // so a sequence is refused here too instead of quietly drawn whole.
  const declared = viewpointsOf(envelope);
  const profile = narrowing.profile;
  const fromProfile = profile?.viewpoints ?? [];
  const named = narrowing.viewpoint;
  if (named !== undefined && declared.length === 0 && fromProfile.length === 0) {
    return { ok: false, reason: "no-viewpoints", viewpoint: named, ...(profile === undefined ? {} : { profile: profile.id }) };
  }
  const own = named === undefined ? undefined : declared.find((candidate) => candidate.id === named);
  const inherited = named === undefined || own !== undefined ? undefined : fromProfile.find((candidate) => candidate.id === named);
  const viewpoint = own ?? inherited;
  if (named !== undefined && viewpoint === undefined) {
    return {
      ok: false,
      reason: "unknown-viewpoint",
      viewpoint: named,
      declared: declared.map((candidate) => candidate.id),
      ...(profile === undefined ? {} : { profile: profile.id, profileDeclared: fromProfile.map((candidate) => candidate.id) }),
    };
  }

  if (envelope.kind === "sequence") {
    const data = envelope.data as StructuredSequenceData;
    const coverage: FigureCoverage = {
      elements: data.participants.length,
      ofElements: data.participants.length,
      relationships: data.messages.length,
      ofRelationships: data.messages.length,
    };
    if (data.participants.length === 0) return { ok: false, reason: "nothing-to-draw", coverage };
    // A sequence is not narrowable here: its key explains the picture and switches
    // nothing. A narrowing named for one is not quietly applied and not quietly
    // dropped either — it simply has no key to act on, which the coverage shows.
    const figure = sequenceFigure(data, { isProposal });
    return { ok: true, svg: serializeFigure(figure), coverage };
  }

  if (envelope.kind !== "graph") return { ok: false, reason: "not-drawable", kind: envelope.kind };

  const data = envelope.data as StructuredGraphData;
  if (inherited !== undefined && profile !== undefined) {
    const elementKinds = new Set(data.nodes.map((node) => node.kind));
    const relationshipKinds = new Set(data.edges.map((edge) => edge.kind));
    const touches =
      (inherited.elementKinds ?? []).some((kind) => elementKinds.has(kind)) ||
      (inherited.relationshipKinds ?? []).some((kind) => relationshipKinds.has(kind));
    if (!touches) return { ok: false, reason: "profile-viewpoint-absent", viewpoint: inherited.id, profile: profile.id };
  }
  const requested: Narrowing =
    narrowing.hiddenElementKinds === undefined && narrowing.hiddenRelationshipKinds === undefined
      ? NOTHING_HIDDEN
      : narrowingOf({
          ...(narrowing.hiddenElementKinds === undefined ? {} : { elementKinds: narrowing.hiddenElementKinds }),
          ...(narrowing.hiddenRelationshipKinds === undefined
            ? {}
            : { relationshipKinds: narrowing.hiddenRelationshipKinds }),
        });
  const hidden: Narrowing =
    viewpoint === undefined ? requested : new Set([...resolveViewpoint(data, viewpoint), ...requested]);
  const shown = shownGraph(data, hidden);
  const coverage: FigureCoverage = {
    elements: shown.nodes.length,
    ofElements: data.nodes.length,
    relationships: shown.edges.length,
    ofRelationships: data.edges.length,
  };
  // Said rather than drawn. An empty canvas written to a path is a success the
  // caller only discovers is worthless when somebody opens the file.
  if (shown.nodes.length === 0) return { ok: false, reason: "nothing-to-draw", coverage };

  const figure = graphFigure(data, { isProposal, hidden, ...(viewpoint === undefined ? {} : { viewpoint }) });
  return {
    ok: true,
    svg: serializeFigure(figure),
    coverage,
    ...(figure.narrowing === undefined ? {} : { narrowing: figure.narrowing }),
    ...(viewpoint === undefined
      ? {}
      : {
          viewpoint: {
            id: viewpoint.id,
            label: viewpoint.label,
            source: inherited === undefined ? ("document" as const) : ("profile" as const),
            ...(inherited === undefined || profile === undefined ? {} : { profile: profile.id }),
          },
        }),
  };
}

/**
 * A figure for a document as it arrived, validated first.
 *
 * The whole gate in one call: bytes, schema, semantics, then the drawing. A caller
 * that gets `ok: false` has nothing to write, which is the point — the refusal is
 * the only thing it can act on.
 */
export function figureForDocument(
  serialized: string,
  checkSchema: StructuredExchangeSchemaCheck,
  narrowing: FigureNarrowing = {},
  limits?: StructuredExchangeLimits,
): FigureExport | FigureRefusal {
  const verdict = readStructuredExchangeDocument(serialized, checkSchema, limits);
  const refused = refusalOf(verdict);
  if (refused !== undefined) return refused;
  return figureForEnvelope((verdict as { status: "valid"; envelope: ValidatedStructuredExchange }).envelope, narrowing);
}

/**
 * The refusal in words, for wherever a person or a model reads it.
 *
 * One sentence per situation, saying what is wrong and — where the answer is not
 * obvious — what would make it right.
 */
export function describeFigureRefusal(refusal: FigureRefusal): string {
  switch (refusal.reason) {
    case "not-a-document":
      return refusal.why === "unparseable"
        ? "not a structured-exchange document: it is not parseable JSON"
        : "not a structured-exchange document: it declares no supported `schema`";
    case "unsupported-version":
      return `declares ${refusal.schema}, which this version does not render`;
    case "invalid":
      return `does not satisfy the structured-exchange schema it declares: ${refusal.issues
        .map((issue) => `${issue.path === "" ? "(document)" : issue.path} ${issue.message}`)
        .join("; ")}`;
    case "too-large":
      return refusal.issue.message;
    case "not-drawable":
      return `a ${refusal.kind} is data rather than a drawing, and has no figure`;
    case "nothing-to-draw":
      return refusal.coverage.ofElements === 0
        ? "the document declares nothing to draw"
        : `the narrowing hides all ${refusal.coverage.ofElements} elements, leaving nothing to draw`;
    case "no-viewpoints":
      return (
        `the document declares no viewpoints` +
        (refusal.profile === undefined ? "" : `, and neither does its profile "${refusal.profile}"`) +
        `, so it has no viewpoint "${refusal.viewpoint}" to draw`
      );
    case "unknown-viewpoint": {
      const list = (ids: readonly string[]) => (ids.length === 0 ? "none" : ids.map((id) => `"${id}"`).join(", "));
      return (
        `the document declares no viewpoint "${refusal.viewpoint}"; it declares ${list(refusal.declared)}` +
        (refusal.profile === undefined ? "" : `, and its profile "${refusal.profile}" declares ${list(refusal.profileDeclared ?? [])}`)
      );
    }
    case "profile-viewpoint-absent":
      return `viewpoint "${refusal.viewpoint}" of profile "${refusal.profile}" retains no kind that occurs in this document, so it would draw nothing of it`;
  }
}

/** What a figure shows, in words, for a result a caller reports back. */
export function describeCoverage(coverage: FigureCoverage): string {
  const whole = coverage.elements === coverage.ofElements && coverage.relationships === coverage.ofRelationships;
  return whole
    ? `the whole document: ${coverage.ofElements} elements and ${coverage.ofRelationships} relationships`
    : `${coverage.elements} of ${coverage.ofElements} elements and ` +
        `${coverage.relationships} of ${coverage.ofRelationships} relationships`;
}
