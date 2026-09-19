/**
 * A structured-exchange document written straight into a reply.
 *
 * Some models answer a request for a diagram by writing the document as a
 * ```` ```json ```` block rather than calling `present_structure`. Such a block is
 * validated against the same contract as a presented document and, when it passes,
 * drawn with the same view — so the reader gets the diagram, not the JSON. A block
 * that is not one of ours stays code; one that declares the schema and fails it stays
 * code under a line saying why.
 *
 * Only replies go through here. The file viewer's Markdown preview keeps the shared
 * `MarkdownPre`: a `.md` file is not an agent presenting anything.
 */
import { createContext, useContext, useMemo } from "react";
import type { StructuredConformance } from "@pi-outpost/shared/structured-exchange/profile";
import { replyBlockKey } from "@pi-outpost/shared/structured-exchange/reply-blocks";
import { StructuredExchangeDocument } from "../presentations/StructuredExchangeView";
import { readStructuredExchangeFile } from "../presentations/structuredExchange";
import { MarkdownPre, fencedCode } from "./Mermaid";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";

/**
 * What the server established about the blocks of this conversation, by
 * `replyBlockKey`. Empty until it says, and for a project that holds nothing to a
 * profile.
 */
export const ReplyConformanceContext = createContext<Readonly<Record<string, StructuredConformance>>>({});

/** A reply's `pre`: a structured-exchange ```json block is drawn, anything else is the shared `pre`. */
export function ReplyMarkdownPre(props: React.HTMLAttributes<HTMLPreElement>) {
  const code = fencedCode(props.children, "json");
  if (code === null) return <MarkdownPre {...props} />;
  return <ReplyJsonBlock code={code} pre={props} />;
}

function ReplyJsonBlock({ code, pre }: { code: string; pre: React.HTMLAttributes<HTMLPreElement> }) {
  const statements = useContext(ReplyConformanceContext);
  // Parsed once per text. While a reply streams, an unfinished block is not JSON yet,
  // so it reads as "not a document" and stays code until it is whole.
  const verdict = useMemo(() => readStructuredExchangeFile(code), [code]);
  if (verdict.status === "not-a-document") return <MarkdownPre {...pre} />;
  if (verdict.status === "valid") {
    const conformance = statements[replyBlockKey(code)];
    return (
      <ViewerErrorBoundary label="This diagram">
        <div className="my-2" data-testid="reply-structured-exchange">
          <StructuredExchangeDocument envelope={verdict.envelope} source={code} {...(conformance ? { conformance } : {})} />
        </div>
      </ViewerErrorBoundary>
    );
  }
  return (
    <div>
      <p data-testid="reply-structured-exchange-refused" className="mb-1 text-xs text-amber-700 dark:text-amber-400">
        This structured-exchange document could not be drawn: {refusal(verdict)}
      </p>
      <MarkdownPre {...pre} />
    </div>
  );
}

function refusal(verdict: Exclude<ReturnType<typeof readStructuredExchangeFile>, { status: "valid" | "not-a-document" }>): string {
  if (verdict.status === "unsupported-version") return `${verdict.schema} is not a version this application implements.`;
  const issue = verdict.status === "invalid" ? verdict.issues[0] : verdict.issue;
  if (issue === undefined) return "it does not satisfy the schema it declares.";
  return `${issue.message} (${issue.rule}${issue.path ? ` at ${issue.path}` : ""})`;
}
