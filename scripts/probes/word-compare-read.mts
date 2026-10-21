/**
 * Word's compared document through the review reading, as docx_compare reads it.
 *
 *   node --import tsx/esm scripts/probes/word-compare-read.mts <compared.docx>
 */
import { readFileSync } from "node:fs";
import { extractDocx } from "../../server/src/docx.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: word-compare-read.mts <compared.docx>");
const extraction = await extractDocx(readFileSync(file), { review: true, full: true });
console.log(extraction.markdown);
