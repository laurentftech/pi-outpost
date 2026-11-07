/** Types for generate-structured-exchange-check.mjs. */

export interface GeneratedCheck {
  version: string;
  /** The JSON schema the check is compiled from. */
  schema: string;
  /** The generated TypeScript module. */
  output: string;
}

export const GENERATED_CHECKS: GeneratedCheck[];
/** The generated check module's source for one contract version. */
export function generate(version?: string): string;
