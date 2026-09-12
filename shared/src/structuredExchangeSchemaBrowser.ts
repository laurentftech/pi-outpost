/**
 * The browser's schema check.
 *
 * A verdict, not a diagnosis. Everyone who has to act on a refusal reads it from
 * the command-line interface or the server, both of which run in Node with the
 * full validator; what the browser decides is only whether to render or fall
 * back. That distinction is worth about 22 KB gzipped, and buys a check that is
 * still generated from the published schema rather than written from it by hand.
 */
import { Check as checkV1 } from "./generated/structuredExchangeCheck.ts";
import { Check as checkV2 } from "./generated/structuredExchangeCheck2.ts";
import { declaredSchemaOf } from "./structuredExchangeDocument.ts";
import {
  STRUCTURED_EXCHANGE_SCHEMA_V1,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
  STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS,
  supportedSchemaOf,
} from "./structuredExchange.ts";
import type { StructuredExchangeSchemaCheck } from "./structuredExchangeParse.ts";

/**
 * A check per version, selected by what the document declares — the same rule the
 * Node validator dispatches by, because a browser that judged a version 1 document
 * against version 2 would render one the server had refused.
 */
const checks = {
  [STRUCTURED_EXCHANGE_SCHEMA_V1]: checkV1,
  [STRUCTURED_EXCHANGE_SCHEMA_V2]: checkV2,
};

export const checkStructuredExchangeSchemaInBrowser: StructuredExchangeSchemaCheck = (document) => {
  const declared = declaredSchemaOf(document);
  const version = supportedSchemaOf(declared);
  if (version === undefined && declared !== undefined) {
    // A version of this contract this build has no check for — distinct from
    // something that is not a structured exchange at all, which is refused below
    // exactly as it was before a second version existed.
    return [
      {
        rule: "unsupported-version",
        path: "/schema",
        message: `this build validates ${STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS.join(" and ")}`,
      },
    ];
  }
  if (checks[version ?? STRUCTURED_EXCHANGE_SCHEMA_V1](document)) return [];
  // One issue, deliberately unspecific: this check knows *that* the document does
  // not conform, and claiming to know *why* would be inventing detail it does not
  // have. The precise reason is available from the reference validator.
  return [
    {
      rule: "schema/invalid",
      path: "",
      message: "does not conform to the published structured-exchange schema",
    },
  ];
};
