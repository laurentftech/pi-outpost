/**
 * Reading an Outlook `.msg`: the compound-file container, the property streams, and
 * the four forms a `.msg` body can take.
 *
 * Every fixture is built by `mailFixtures.ts` rather than committed as an opaque
 * binary, so what each case exercises is legible — and the builder writes real
 * containers, mini-FAT and all, so the reader's two stream paths are both used.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { MailError, readMessage } from "../src/mail.ts";
import { decompressRtf, htmlFromEncapsulatedRtf, textFromRtf } from "../src/mailMsg.ts";
import {
  binaryProperty,
  compressRtf,
  cp1252,
  MSG_TAG,
  numberProperty,
  outlookMessage,
  uncompressedRtf,
  unicodeProperty,
  writeCompoundFile,
} from "./mailFixtures.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** RTF as Outlook writes an HTML body: the markup in `\*\htmltag` destinations. */
const ENCAPSULATED_RTF = String.raw`{\rtf1\ansi\ansicpg1252\fromhtml1 \htmlrtf {\htmlrtf0 {\*\htmltag84 <html>}{\*\htmltag84 <body>}{\*\htmltag112 <p>}Bonjour, voici le \htmlrtf\b\htmlrtf0 {\*\htmltag84 <b>}dossier{\*\htmltag92 </b>}\htmlrtf\b0\htmlrtf0  de mardi.{\*\htmltag116 </p>}{\*\htmltag88 </body>}{\*\htmltag88 </html>}}}`;

const PLAIN_RTF = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fnil Calibri;}}{\colortbl ;\red0\green0\blue0;}\pard\f0\fs22 Bonjour,\par Voici le r\'e9sum\'e9.\par}`;

describe("the compound-file container", () => {
  test("reads a message whose streams take both the mini-FAT and the FAT paths", () => {
    // 9 KiB is past the 4 KiB cutoff, so it gets its own sectors; every property
    // stream beside it is small and lives in the mini stream.
    const large = Buffer.alloc(9000, 0x41);
    const read = readMessage(
      outlookMessage({
        subject: "Deux chemins",
        body: "corps",
        attachments: [
          { name: "big.bin", mediaType: "application/octet-stream", content: large },
          { name: "small.txt", mediaType: "text/plain", content: Buffer.from("petit") },
        ],
      }),
    );
    assert.equal(read.format, "msg");
    assert.equal(read.subject, "Deux chemins");
    assert.ok(read.attachments[0].content?.equals(large), "the large stream came back intact");
    assert.equal(read.attachments[1].content?.toString("utf8"), "petit");
  });

  test("terminates on a file whose allocation table points in a circle", () => {
    const file = outlookMessage({ subject: "Boucle", body: "corps", attachments: [{ name: "a.bin", content: Buffer.alloc(9000, 7) }] });
    // The first FAT sector is named in the header; make its first chain entry point
    // at itself, which is the shape a corrupt or hostile file has.
    const fatSector = file.readUInt32LE(76);
    const fatAt = 512 + fatSector * 512;
    file.writeUInt32LE(0, fatAt); // sector 0 -> sector 0
    const started = Date.now();
    try {
      readMessage(file);
    } catch (error) {
      assert.ok(error instanceof MailError, `expected a MailError, got ${String(error)}`);
    }
    assert.ok(Date.now() - started < 2000, "reading a looping chain must not hang");
  });

  test("refuses a compound file that holds no message properties", () => {
    const notAMessage = writeCompoundFile([{ name: "WordDocument", data: Buffer.from("not a message") }]);
    assert.throws(() => readMessage(notAMessage), (error: unknown) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.reason, "unreadable");
      assert.match(error.message, /not an Outlook message/);
      return true;
    });
  });

  test("refuses a file too short to be a compound file", () => {
    const stub = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(16)]);
    assert.throws(() => readMessage(stub), /too short to be an Outlook message/);
  });
});

describe("properties", () => {
  test("decodes Unicode properties", () => {
    const read = readMessage(
      outlookMessage({
        subject: "Réunion du comité",
        senderName: "François Girard",
        senderEmail: "francois@example.test",
        body: "corps",
      }),
    );
    assert.equal(read.subject, "Réunion du comité");
    assert.deepEqual(read.from, { name: "François Girard", address: "francois@example.test" });
  });

  test("decodes 8-bit properties through the message's code page", () => {
    const read = readMessage(
      outlookMessage({
        ansi: true,
        codepage: 1252,
        subject: "Réunion très urgente",
        senderName: "François Gérard",
        senderEmail: "francois@example.test",
        body: "Voilà le résumé.",
      }),
    );
    assert.equal(read.subject, "Réunion très urgente");
    assert.equal(read.from?.name, "François Gérard");
    assert.match(read.body?.markdown ?? "", /Voilà le résumé\./);
    assert.doesNotMatch(read.body?.markdown ?? "", /�/);
  });

  test("says so when the declared code page is one it does not know", () => {
    const read = readMessage(
      outlookMessage({ ansi: true, codepage: 51949, subject: "Inconnu", body: "corps" }),
    );
    assert.ok(
      read.notes.some((note) => /51949/.test(note) && /windows-1252/.test(note)),
      JSON.stringify(read.notes),
    );
  });

  test("reads the recipients from the recipient table", () => {
    const read = readMessage(
      outlookMessage({
        subject: "s",
        body: "corps",
        recipients: [
          { name: "Laurent", address: "laurent@example.test", type: 1 },
          { address: "copie@example.test", type: 2 },
          { address: "cache@example.test", type: 3 },
        ],
      }),
    );
    assert.deepEqual(read.to, [{ name: "Laurent", address: "laurent@example.test" }]);
    assert.deepEqual(read.cc, [{ address: "copie@example.test" }]);
    assert.deepEqual(read.bcc, [{ address: "cache@example.test" }]);
  });

  test("falls back to the display header when a message was saved without its recipient table", () => {
    const read = readMessage(outlookMessage({ subject: "s", body: "corps", displayTo: "Laurent; Paul" }));
    assert.equal(read.to.length, 1);
    assert.match(read.to[0].address, /Laurent/);
  });

  test("takes the date from the transport headers the message kept", () => {
    const read = readMessage(
      outlookMessage({
        subject: "s",
        body: "corps",
        transportHeaders: "Received: from x\r\nDate: Tue, 22 Sep 2026 09:14:00 +0200\r\nFrom: a@x.test\r\n",
      }),
    );
    assert.equal(read.date, new Date("Tue, 22 Sep 2026 09:14:00 +0200").toISOString());
  });
});

describe("bodies", () => {
  test("prefers the plain-text body", () => {
    const read = readMessage(outlookMessage({ subject: "s", body: "Le texte simple.", bodyHtml: "<p>Le HTML</p>" }));
    assert.equal(read.body?.form, "plain text");
    assert.match(read.body?.markdown ?? "", /Le texte simple\./);
  });

  test("reads an HTML body stored as bytes, honouring its own declared charset", () => {
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="iso-8859-1"></head><body><p>', "latin1"),
      cp1252("Réunion à Paris"),
      Buffer.from("</p></body></html>", "latin1"),
    ]);
    const read = readMessage(outlookMessage({ subject: "s", bodyHtml: html }));
    assert.equal(read.body?.form, "HTML");
    assert.match(read.body?.markdown ?? "", /Réunion à Paris/);
  });

  test("recovers the HTML a compressed rich-text body encapsulates", () => {
    const read = readMessage(outlookMessage({ subject: "s", bodyRtfCompressed: compressRtf(ENCAPSULATED_RTF) }));
    assert.equal(read.body?.form, "HTML recovered from rich text");
    assert.match(read.body?.markdown ?? "", /Bonjour, voici le \*\*dossier\*\* de mardi\./);
    // The `\htmlrtf` rendering must not be taken as well, or every sentence doubles.
    assert.equal((read.body?.markdown.match(/dossier/g) ?? []).length, 1);
  });

  test("reads an uncompressed rich-text body, which the format also allows", () => {
    const read = readMessage(outlookMessage({ subject: "s", bodyRtfCompressed: uncompressedRtf(ENCAPSULATED_RTF) }));
    assert.equal(read.body?.form, "HTML recovered from rich text");
    assert.match(read.body?.markdown ?? "", /voici le \*\*dossier\*\*/);
  });

  test("reads genuine rich text as text, and says that is what it read", () => {
    const read = readMessage(outlookMessage({ subject: "s", bodyRtfCompressed: compressRtf(PLAIN_RTF) }));
    assert.equal(read.body?.form, "rich text");
    assert.match(read.body?.markdown ?? "", /Bonjour,/);
    assert.match(read.body?.markdown ?? "", /Voici le résumé\./);
    // The font and colour tables are not prose.
    assert.doesNotMatch(read.body?.markdown ?? "", /fonttbl|Calibri|colortbl/);
  });

  test("names the forms it holds when the rich-text body will not decompress", () => {
    const rubbish = Buffer.alloc(64, 0x5a);
    rubbish.writeUInt32LE(48, 0);
    rubbish.writeUInt32LE(100, 4);
    rubbish.writeUInt32LE(0x11223344, 8); // neither "LZFu" nor "MELA"
    const read = readMessage(outlookMessage({ subject: "s", bodyRtfCompressed: rubbish }));
    assert.equal(read.body, undefined);
    assert.match(read.bodyUnreadable?.reason ?? "", /could not be decompressed/);
    assert.deepEqual(read.bodyUnreadable?.formsHeld, ["compressed rich text"]);
  });

  test("a message with no body property says so rather than returning nothing", () => {
    const read = readMessage(outlookMessage({ subject: "Sans corps" }));
    assert.equal(read.body, undefined);
    assert.match(read.bodyUnreadable?.reason ?? "", /no body property/);
  });

  test("decompressRtf refuses a stream that is not one", () => {
    assert.equal(decompressRtf(Buffer.alloc(4)), null);
    assert.equal(decompressRtf(Buffer.alloc(32)), null);
  });

  test("the dictionary is preloaded, which is what makes the first bytes decode", () => {
    // `{\rtf1\ansi` is in the preloaded window, so the compressor emits it as a
    // reference. A reader that skipped the preload returns the right length here and
    // the wrong bytes.
    const round = decompressRtf(compressRtf(ENCAPSULATED_RTF));
    assert.equal(round?.toString("latin1"), ENCAPSULATED_RTF);
  });

  test("decompresses a body long enough to wrap the window", () => {
    // The window is 4096 bytes and is written round-robin, so a body past that size
    // is the only thing that exercises the wrap — and an off-by-one in the modulo
    // arithmetic corrupts everything after the 4096th byte, not before it.
    const long = String.raw`{\rtf1\ansi\fromhtml1 {\*\htmltag84 <html>}{\*\htmltag112 <p>}` +
      Array.from({ length: 400 }, (_, index) => `phrase ${index} de ce message assez long. `).join("") +
      String.raw`{\*\htmltag116 </p>}{\*\htmltag88 </html>}}`;
    assert.ok(long.length > 4096 * 2, "the fixture must be long enough to wrap twice");

    const round = decompressRtf(compressRtf(long));
    assert.equal(round?.toString("latin1"), long);

    const read = readMessage(outlookMessage({ subject: "s", bodyRtfCompressed: compressRtf(long) }));
    assert.equal(read.body?.form, "HTML recovered from rich text");
    assert.match(read.body?.markdown ?? "", /phrase 0 de ce message/);
    assert.match(read.body?.markdown ?? "", /phrase 399 de ce message/);
  });

  test("htmlFromEncapsulatedRtf leaves genuine rich text alone", () => {
    assert.equal(htmlFromEncapsulatedRtf(PLAIN_RTF), null);
    assert.match(htmlFromEncapsulatedRtf(ENCAPSULATED_RTF) ?? "", /^<html>/);
  });

  test("textFromRtf decodes an escaped byte and drops the tables", () => {
    assert.match(textFromRtf(PLAIN_RTF), /Voici le résumé\./);
  });
});

describe("attachments", () => {
  test("lists each attachment with its identifier, name, type and size", () => {
    const deck = Buffer.from("PK\u0003\u0004 deck", "latin1");
    const read = readMessage(
      outlookMessage({
        subject: "s",
        body: "corps",
        attachments: [
          { name: "présentation.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", content: deck },
          { name: "contrat.pdf", content: Buffer.from("%PDF-1.7") },
          { name: "notes.txt", mediaType: "text/plain", content: Buffer.from("des notes") },
        ],
      }),
    );
    assert.deepEqual(
      read.attachments.map((attachment) => [attachment.id, attachment.claimedName, attachment.mediaType, attachment.size]),
      [
        ["1", "présentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", deck.length],
        // Outlook often labels nothing; the name is then the only evidence of type.
        ["2", "contrat.pdf", "application/pdf", 8],
        ["3", "notes.txt", "text/plain", 9],
      ],
    );
    assert.ok(read.attachments[0].content?.equals(deck));
  });

  test("marks an image the body renders as inline", () => {
    const read = readMessage(
      outlookMessage({
        subject: "s",
        bodyHtml: '<p>Bonjour<img src="cid:logo@sig"></p>',
        attachments: [
          { name: "logo.png", mediaType: "image/png", content: Buffer.from("\x89PNG", "latin1"), contentId: "logo@sig", renderedInBody: true },
          { name: "rapport.pdf", mediaType: "application/pdf", content: Buffer.from("%PDF") },
        ],
      }),
    );
    assert.equal(read.attachments[0].inline, true);
    assert.equal(read.attachments[0].contentId, "logo@sig");
    assert.equal(read.attachments[1].inline, false);
  });

  test("lists an attachment whose content stream is missing, with the reason", () => {
    const read = readMessage(
      outlookMessage({ subject: "s", body: "corps", attachments: [{ name: "vide.pdf", mediaType: "application/pdf" }] }),
    );
    assert.equal(read.attachments.length, 1);
    assert.match(read.attachments[0].unreadable ?? "", /not stored in this file/);
    assert.equal(read.attachments[0].content, undefined);
    assert.ok(read.notes.some((note) => /vide\.pdf/.test(note)), JSON.stringify(read.notes));
  });

  test("names an embedded message by its subject and says it has no bytes to unpack", () => {
    const read = readMessage(
      outlookMessage({
        subject: "Transfert",
        body: "corps",
        attachments: [{ name: "message joint", method: 5, embeddedSubject: "Le message d'origine" }],
      }),
    );
    assert.equal(read.attachments.length, 1);
    assert.equal(read.attachments[0].messageSubject, "Le message d'origine");
    assert.equal(read.attachments[0].mediaType, "message/rfc822");
    assert.match(read.attachments[0].unreadable ?? "", /no bytes to unpack/);
  });

  test("identifiers follow the message's own order, not the directory's shape", () => {
    // Ten attachments: enough that the directory tree's traversal order and the
    // storage names' order are not the same.
    const read = readMessage(
      outlookMessage({
        subject: "s",
        body: "corps",
        attachments: Array.from({ length: 10 }, (_, index) => ({
          name: `piece-${index}.txt`,
          mediaType: "text/plain",
          content: Buffer.from(`contenu ${index}`),
        })),
      }),
    );
    assert.deepEqual(
      read.attachments.map((attachment) => attachment.claimedName),
      Array.from({ length: 10 }, (_, index) => `piece-${index}.txt`),
    );
    assert.deepEqual(
      read.attachments.map((attachment) => attachment.id),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
  });

  test("reads the committed fixture back off disk", async () => {
    // The in-memory cases are legible; this one is the round trip through a binary
    // blob and a git checkout, which is where a `.msg` mangled into text would show.
    const read = readMessage(await readFile(path.join(FIXTURES, "mail-outlook.msg")));
    assert.equal(read.format, "msg");
    assert.equal(read.subject, "Réunion de mardi — dossier complet");
    assert.equal(read.from?.address, "francois.girard@example.test");
    assert.deepEqual(read.to, [{ name: "Laurent", address: "laurent@example.test" }]);
    assert.equal(read.date, new Date("Tue, 22 Sep 2026 09:14:00 +0200").toISOString());
    assert.equal(read.body?.form, "HTML recovered from rich text");
    assert.match(read.body?.markdown ?? "", /Voici la \*\*présentation\*\* et le rapport\./);
    assert.deepEqual(
      read.attachments.map((attachment) => attachment.claimedName),
      ["présentation.pptx", "rapport.pdf", "notes.txt"],
    );
    assert.equal(read.attachments[1].content?.subarray(0, 8).toString("latin1"), "%PDF-1.7");
  });

  test("reads an attachment named only by the short file-name property", () => {
    const read = readMessage(
      outlookMessage({
        subject: "s",
        body: "corps",
        extra: [
          {
            name: "__attach_version1.0_#00000000",
            children: [
              unicodeProperty(MSG_TAG.attachFilename, "COURT.TXT"),
              binaryProperty(MSG_TAG.attachData, Buffer.from("abc")),
              numberProperty(MSG_TAG.attachMethod, 1),
            ],
          },
        ],
      }),
    );
    assert.equal(read.attachments[0].claimedName, "COURT.TXT");
    assert.equal(read.attachments[0].mediaType, "text/plain");
  });
});
