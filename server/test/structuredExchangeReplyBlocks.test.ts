/**
 * Finding structured-exchange documents written into a reply, and keying them so the
 * server's statement reaches the block the browser drew.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { replyBlockKey, structuredExchangeBlocks } from "@pi-outpost/shared/structured-exchange/reply-blocks";

const doc = '{"schema":"urn:structured-exchange:1","kind":"table","columns":[{"key":"a","label":"A"}],"rows":[]}';

describe("structured-exchange blocks in a reply", () => {
  test("a json block declaring the schema is found, with its content exactly", () => {
    assert.deepEqual(structuredExchangeBlocks(`Here it is:\n\n\`\`\`json\n${doc}\n\`\`\`\n\nDone.`), [doc]);
  });

  test("other languages, undeclared json and prose are not", () => {
    const reply = [
      "```ts",
      doc,
      "```",
      "```json",
      '{"name":"package"}',
      "```",
      `inline ${doc} in prose`,
    ].join("\n");
    assert.deepEqual(structuredExchangeBlocks(reply), []);
  });

  test("an unterminated block — a reply still streaming — is not a document yet", () => {
    assert.deepEqual(structuredExchangeBlocks(`\`\`\`json\n${doc}\n`), []);
  });

  test("a longer fence holds a shorter one, and closes only on its own length", () => {
    assert.deepEqual(structuredExchangeBlocks(`\`\`\`\`json\n${doc}\n\`\`\`\``), [doc]);
    // Had the three-backtick line closed it, the body would be the document alone and
    // be returned; held open, the body carries that line and is no longer JSON.
    assert.deepEqual(structuredExchangeBlocks(`\`\`\`\`json\n${doc}\n\`\`\`\n\`\`\`\``), []);
    assert.deepEqual(structuredExchangeBlocks(`~~~~json\n${doc}\n~~~~`), [doc]);
  });

  test("an indented fence loses its indentation, as a renderer strips it", () => {
    assert.deepEqual(structuredExchangeBlocks(`  \`\`\`json\n  ${doc}\n  \`\`\``), [doc]);
  });

  test("CRLF replies are read like LF ones", () => {
    assert.deepEqual(structuredExchangeBlocks(`\`\`\`json\r\n${doc}\r\n\`\`\``), [doc]);
  });
});

describe("a block's key", () => {
  test("ignores line endings and trailing whitespace, and nothing else", () => {
    assert.equal(replyBlockKey(`${doc}\n`), replyBlockKey(doc));
    assert.equal(replyBlockKey(doc.replace(/,/g, ",\r\n")), replyBlockKey(doc.replace(/,/g, ",\n")));
    assert.notEqual(replyBlockKey(doc), replyBlockKey(doc.replace('"A"', '"B"')));
  });
});
