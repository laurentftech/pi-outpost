/**
 * Reading an internet message: what a `.eml` or `.emlx` yields, and what it is
 * refused for.
 *
 * The Outlook side lives in mailMsg.test.ts; the tool that wraps both — its
 * confinement, its bounds and its unpacking — in mailTool.test.ts. What is checked
 * here is the reading itself: structure, encodings, body choice, inventory.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  decodeEncodedWords,
  decodeQuotedPrintable,
  decodeText,
  MailError,
  parseAddresses,
  parseStructured,
  readMessage,
  sniffFormat,
  splitHeaders,
} from "../src/mail.ts";
import { appleMailMessage, internetMessage, outlookMessage } from "./mailFixtures.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A `multipart/mixed` message, assembled the way a mailer assembles one. */
function multipart(
  boundary: string,
  parts: { headers: Record<string, string>; body: string }[],
  options: { headers?: Record<string, string>; subtype?: string; closed?: boolean } = {},
): Buffer {
  const pieces = parts.map(
    (part) =>
      `--${boundary}\r\n${Object.entries(part.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n")}\r\n\r\n${part.body}\r\n`,
  );
  const closing = options.closed === false ? "" : `--${boundary}--\r\n`;
  return internetMessage(
    {
      From: "sender@example.test",
      To: "laurent@example.test",
      Subject: "Test",
      "MIME-Version": "1.0",
      "Content-Type": `multipart/${options.subtype ?? "mixed"}; boundary="${boundary}"`,
      ...options.headers,
    },
    `${pieces.join("")}${closing}`,
  );
}

describe("sniffFormat", () => {
  test("decides from the bytes, not the extension", () => {
    const msg = outlookMessage({ subject: "Compound" });
    const eml = internetMessage({ From: "a@x.test", Subject: "MIME" }, "body\r\n");

    // The file a colleague named "message.eml" but Outlook wrote as a .msg.
    assert.equal(sniffFormat(msg), "msg");
    assert.equal(readMessage(msg).format, "msg");
    // …and the reverse: a MIME message saved as .msg.
    assert.equal(sniffFormat(eml), "eml");
    assert.equal(readMessage(eml).format, "eml");
  });

  test("recognises Apple Mail's byte-count prefix", () => {
    const eml = internetMessage({ From: "a@x.test", Subject: "Apple" }, "body\r\n");
    assert.equal(sniffFormat(appleMailMessage(eml)), "emlx");
  });
});

describe("splitHeaders", () => {
  test("unfolds a continued header and keeps repeats in order", () => {
    const { headers, body } = splitHeaders(
      Buffer.from("Subject: a very\r\n long subject\r\nReceived: one\r\nReceived: two\r\n\r\nthe body\r\n", "latin1"),
    );
    assert.equal(headers.get("subject")?.[0], "a very long subject");
    assert.deepEqual(headers.get("received"), ["one", "two"]);
    assert.equal(body.toString("latin1"), "the body\r\n");
  });

  test("reads a message whose line endings are bare newlines", () => {
    const { headers, body } = splitHeaders(Buffer.from("Subject: s\nTo: a@x.test\n\nbody\n", "latin1"));
    assert.equal(headers.get("subject")?.[0], "s");
    assert.equal(body.toString("latin1"), "body\n");
  });
});

describe("readMessage: an internet message", () => {
  const message = internetMessage(
    {
      From: '"Girard, François" <francois@example.test>',
      To: "Laurent <laurent@example.test>, second@example.test",
      Subject: "Dossier de mardi",
      Date: "Tue, 22 Sep 2026 09:14:00 +0200",
      "MIME-Version": "1.0",
      "Content-Type": "text/plain; charset=utf-8",
    },
    Buffer.from("Bonjour,\r\n\r\nVoici le dossier.\r\n", "utf8"),
  );

  test("returns the headers a reader needs", () => {
    const read = readMessage(message);
    assert.equal(read.subject, "Dossier de mardi");
    assert.deepEqual(read.from, { name: "Girard, François", address: "francois@example.test" });
    assert.deepEqual(read.to, [{ name: "Laurent", address: "laurent@example.test" }, { address: "second@example.test" }]);
    assert.equal(read.date, new Date("Tue, 22 Sep 2026 09:14:00 +0200").toISOString());
    assert.equal(read.body?.form, "plain text");
    assert.match(read.body?.markdown ?? "", /Voici le dossier\./);
  });

  test("a header the message does not carry is absent, not empty", () => {
    const read = readMessage(message);
    assert.deepEqual(read.cc, []);
    assert.deepEqual(read.bcc, []);
  });

  test("returns Bcc when the file holds it, as a sent copy does", () => {
    const sent = internetMessage(
      { From: "a@x.test", To: "b@x.test", Bcc: "hidden@x.test", Subject: "s", "Content-Type": "text/plain" },
      "body\r\n",
    );
    assert.deepEqual(readMessage(sent).bcc, [{ address: "hidden@x.test" }]);
  });

  test("keeps an unparseable date as the message wrote it", () => {
    const odd = internetMessage({ From: "a@x.test", Subject: "s", Date: "sometime last week" }, "body\r\n");
    assert.equal(readMessage(odd).date, "sometime last week");
  });

  test("refuses a file that is not a message", () => {
    assert.throws(() => readMessage(Buffer.from("just some notes\nnothing here\n", "utf8")), (error: unknown) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.reason, "unreadable");
      assert.match(error.message, /not an email message/);
      return true;
    });
  });

  test("reads the committed fixture whatever line endings the checkout gave it", async () => {
    // Checked in as text on purpose: git hands a Windows working tree CRLF and a
    // Linux one LF, and the reader must not care which. The fixture is read as it
    // sits, and then again with every CRLF flattened, so both are proven here.
    const onDisk = await readFile(path.join(FIXTURES, "mail-thread.eml"));
    const flattened = Buffer.from(onDisk.toString("latin1").replace(/\r\n/g, "\n"), "latin1");

    for (const [label, bytes] of [["as checked out", onDisk], ["with bare newlines", flattened]] as const) {
      const read = readMessage(bytes);
      assert.equal(read.subject, "Réunion de mardi — dossier", label);
      assert.deepEqual(read.from, { name: "François Girard", address: "francois.girard@example.test" }, label);
      assert.deepEqual(read.cc, [{ address: "comite@example.test" }], label);
      assert.match(read.body?.markdown ?? "", /Voici la présentation et le rapport\./, label);
      assert.match(read.body?.markdown ?? "", /^> et le budget \?$/m, label);
      assert.deepEqual(
        read.attachments.map((attachment) => [attachment.claimedName, attachment.mediaType]),
        [
          ["présentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
          ["rapport.pdf", "application/pdf"],
        ],
        label,
      );
      assert.equal(read.attachments[1].content?.subarray(0, 8).toString("latin1"), "%PDF-1.7", label);
    }
  });

  test("reads an .emlx without its count line or its property list", () => {
    const read = readMessage(appleMailMessage(message));
    assert.equal(read.format, "emlx");
    assert.equal(read.subject, "Dossier de mardi");
    assert.match(read.body?.markdown ?? "", /Voici le dossier\./);
    assert.doesNotMatch(read.body?.markdown ?? "", /plist|integer/);
  });
});

describe("readMessage: encodings", () => {
  test("decodes an encoded-word subject with its accents", () => {
    const read = readMessage(
      internetMessage({ From: "a@x.test", Subject: "=?UTF-8?Q?R=C3=A9union_de_mardi?=", "Content-Type": "text/plain" }, "b\r\n"),
    );
    assert.equal(read.subject, "Réunion de mardi");
  });

  test("joins a subject split across several encoded words", () => {
    const read = readMessage(
      internetMessage(
        { From: "a@x.test", Subject: "=?UTF-8?B?UsOpdW5pb24gZHU=?= =?UTF-8?B?IGNvbWl0w6k=?=", "Content-Type": "text/plain" },
        "b\r\n",
      ),
    );
    // The space separating the words is the encoding's, not the subject's.
    assert.equal(read.subject, "Réunion du comité");
  });

  test("decodes a display name encoded apart from its address", () => {
    const read = readMessage(
      internetMessage(
        { From: "=?ISO-8859-1?Q?Fran=E7ois_G=E9rard?= <francois@example.test>", Subject: "s", "Content-Type": "text/plain" },
        "b\r\n",
      ),
    );
    assert.deepEqual(read.from, { name: "François Gérard", address: "francois@example.test" });
  });

  test("decodes a quoted-printable Latin-1 body", () => {
    const read = readMessage(
      internetMessage(
        {
          From: "a@x.test",
          Subject: "s",
          "Content-Type": "text/plain; charset=ISO-8859-1",
          "Content-Transfer-Encoding": "quoted-printable",
        },
        "Voil=E9 le r=E9sum=E9 tr=E8s=\r\n court.\r\n",
      ),
    );
    assert.match(read.body?.markdown ?? "", /Voilà|Voilé/);
    assert.match(read.body?.markdown ?? "", /résumé très court\./);
    assert.doesNotMatch(read.body?.markdown ?? "", /=E9|�/);
  });

  test("decodes a base64 body", () => {
    const read = readMessage(
      internetMessage(
        { From: "a@x.test", Subject: "s", "Content-Type": "text/plain; charset=utf-8", "Content-Transfer-Encoding": "base64" },
        `${Buffer.from("Café crème\r\n", "utf8").toString("base64")}\r\n`,
      ),
    );
    assert.match(read.body?.markdown ?? "", /Café crème/);
  });

  test("an unknown character set falls back, and says which part it fell back for", () => {
    const read = readMessage(
      internetMessage({ From: "a@x.test", Subject: "s", "Content-Type": "text/plain; charset=x-nonesuch-9" }, "caf\xe9\r\n"),
    );
    assert.match(read.body?.markdown ?? "", /café/);
    assert.ok(
      read.notes.some((note) => /x-nonesuch-9/.test(note) && /windows-1252/.test(note)),
      `expected a fallback note, got ${JSON.stringify(read.notes)}`,
    );
  });

  test("decodeText reads the windows-1252 range without relying on the runtime's tables", () => {
    // 0x92 is a curly apostrophe in windows-1252 and undefined in Latin-1. Every
    // label below must produce the same character, whatever ICU data is present.
    for (const label of ["windows-1252", "iso-8859-1", "latin1"]) {
      assert.equal(decodeText(Buffer.from([0x4c, 0x92, 0x61]), label).text, "L’a", label);
    }
    assert.equal(decodeText(Buffer.from([0x80]), "windows-1252").text, "€");
    assert.equal(decodeText(Buffer.from("é", "utf8"), "utf-8").text, "é");
  });

  test("decodeQuotedPrintable keeps a lone equals sign and folds a soft break", () => {
    assert.equal(decodeQuotedPrintable(Buffer.from("a=\r\nb", "latin1")).toString("latin1"), "ab");
    assert.equal(decodeQuotedPrintable(Buffer.from("a=\nb", "latin1")).toString("latin1"), "ab");
    assert.equal(decodeQuotedPrintable(Buffer.from("2 = 2", "latin1")).toString("latin1"), "2 = 2");
  });

  test("decodeEncodedWords leaves ordinary text alone", () => {
    assert.equal(decodeEncodedWords("Re: budget").text, "Re: budget");
  });

  test("parseAddresses reads a group and a quoted comma", () => {
    assert.deepEqual(parseAddresses('Team: a@x.test, "Doe, Jane" <jane@x.test>;'), [
      { address: "a@x.test" },
      { name: "Doe, Jane", address: "jane@x.test" },
    ]);
  });
});

describe("parseStructured", () => {
  test("reads parameters, quoted values and an encoded-word file name", () => {
    const parsed = parseStructured('attachment; filename="=?UTF-8?Q?r=C3=A9sum=C3=A9.pdf?="; size=12');
    assert.equal(parsed.value, "attachment");
    assert.equal(parsed.params.filename, "résumé.pdf");
    assert.equal(parsed.params.size, "12");
  });

  test("assembles an RFC 2231 continued, charset-tagged file name", () => {
    const parsed = parseStructured(
      "attachment; filename*0*=UTF-8''%72%C3%A9union%20; filename*1*=%64%75%20comit%C3%A9.docx",
    );
    assert.equal(parsed.params.filename, "réunion du comité.docx");
  });
});

describe("readMessage: structure", () => {
  test("prefers the plain-text part of an alternative", () => {
    const read = readMessage(
      multipart(
        "alt1",
        [
          { headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "La version texte, complète et utile.\r\nDeuxième ligne." },
          { headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<p>La version <b>HTML</b></p>" },
        ],
        { subtype: "alternative" },
      ),
    );
    assert.equal(read.body?.form, "plain text");
    assert.match(read.body?.markdown ?? "", /version texte/);
  });

  test("reads the HTML part when the plain one is a stub", () => {
    const html = `<p>${"Le corps du message, en détail. ".repeat(40)}</p>`;
    const read = readMessage(
      multipart(
        "alt2",
        [
          { headers: { "Content-Type": "text/plain" }, body: "To view this message in your browser, click here." },
          { headers: { "Content-Type": "text/html; charset=utf-8" }, body: html },
        ],
        { subtype: "alternative" },
      ),
    );
    assert.equal(read.body?.form, "HTML");
    assert.match(read.body?.markdown ?? "", /Le corps du message/);
  });

  test("a body part marked inline is the body, not an attachment", () => {
    // What a great many mailers write, and what an earlier version of the reader took
    // for a file: the message then came back with its text listed as an attachment and
    // its body reported unreadable.
    const read = readMessage(
      multipart("inl1", [
        { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "inline" }, body: "Le corps du message." },
        {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="rapport.pdf"', "Content-Transfer-Encoding": "base64" },
          body: Buffer.from("%PDF-1.4", "latin1").toString("base64"),
        },
      ]),
    );
    assert.equal(read.body?.form, "plain text");
    assert.match(read.body?.markdown ?? "", /Le corps du message\./);
    assert.deepEqual(
      read.attachments.map((attachment) => attachment.claimedName),
      ["rapport.pdf"],
      "the body is not among the attachments",
    );
  });

  test("a text part that names a file is an attachment, inline or not", () => {
    const read = readMessage(
      multipart("inl2", [
        { headers: { "Content-Type": "text/plain" }, body: "Voir le journal." },
        { headers: { "Content-Type": "text/plain", "Content-Disposition": 'inline; filename="journal.log"' }, body: "line one" },
      ]),
    );
    assert.match(read.body?.markdown ?? "", /Voir le journal\./);
    assert.deepEqual(
      read.attachments.map((attachment) => [attachment.claimedName, attachment.inline]),
      [["journal.log", true]],
    );
  });

  test("lists the attachments of a mixed message with their types and sizes", () => {
    const deck = Buffer.from("PK\u0003\u0004 a deck", "latin1");
    const read = readMessage(
      multipart("mix1", [
        { headers: { "Content-Type": "text/plain" }, body: "Voir les pièces jointes." },
        {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": 'attachment; filename="deck.pptx"',
            "Content-Transfer-Encoding": "base64",
          },
          body: deck.toString("base64"),
        },
        {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="contrat.pdf"', "Content-Transfer-Encoding": "base64" },
          body: Buffer.from("%PDF-1.4 x", "latin1").toString("base64"),
        },
        { headers: { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="notes.txt"' }, body: "des notes" },
      ]),
    );

    assert.deepEqual(
      read.attachments.map((attachment) => [attachment.id, attachment.claimedName, attachment.mediaType, attachment.size]),
      [
        ["1", "deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", deck.length],
        ["2", "contrat.pdf", "application/pdf", 10],
        ["3", "notes.txt", "text/plain", 9],
      ],
    );
    // The bytes are the sender's bytes, which is what makes pptx_extract work.
    assert.ok(read.attachments[0].content?.equals(deck));
    assert.match(read.body?.markdown ?? "", /pièces jointes/);
  });

  test("distinguishes an inline image from a document attachment", () => {
    const read = readMessage(
      multipart(
        "rel1",
        [
          { headers: { "Content-Type": "text/html" }, body: '<p>Bonjour<img src="cid:logo@sig"></p>' },
          {
            headers: {
              "Content-Type": "image/png",
              "Content-ID": "<logo@sig>",
              "Content-Disposition": 'inline; filename="logo.png"',
              "Content-Transfer-Encoding": "base64",
            },
            body: Buffer.from("\x89PNG\r\n\x1a\n", "latin1").toString("base64"),
          },
        ],
        { subtype: "related" },
      ),
    );
    assert.equal(read.attachments.length, 1);
    assert.equal(read.attachments[0].inline, true);
    assert.equal(read.attachments[0].contentId, "logo@sig");
    // The body reference is reported, so the two can be tied together.
    assert.match(read.body?.markdown ?? "", /cid:logo@sig/);
  });

  test("names a forwarded message by its subject", () => {
    const inner = internetMessage({ From: "x@x.test", Subject: "Le message d'origine", "Content-Type": "text/plain" }, "corps\r\n");
    const read = readMessage(
      multipart("fwd1", [
        { headers: { "Content-Type": "text/plain" }, body: "Je te transfère ceci." },
        { headers: { "Content-Type": "message/rfc822", "Content-Disposition": "attachment" }, body: inner.toString("latin1") },
      ]),
    );
    assert.equal(read.attachments.length, 1);
    assert.equal(read.attachments[0].messageSubject, "Le message d'origine");
    assert.equal(read.attachments[0].mediaType, "message/rfc822");
  });

  test("says so when a message carries no attachments", () => {
    const read = readMessage(internetMessage({ From: "a@x.test", Subject: "s", "Content-Type": "text/plain" }, "corps\r\n"));
    assert.deepEqual(read.attachments, []);
  });

  test("yields what it can from a truncated multipart, and names what failed", () => {
    const truncated = multipart(
      "cut1",
      [
        { headers: { "Content-Type": "text/plain" }, body: "Le début du message." },
        { headers: { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="a.txt"' }, body: "coupé" },
      ],
      { closed: false },
    );
    const read = readMessage(truncated);
    assert.match(read.body?.markdown ?? "", /Le début du message\./);
    assert.equal(read.attachments.length, 1);
    assert.ok(read.notes.some((note) => /closing boundary/.test(note)), JSON.stringify(read.notes));
  });

  test("reads a multipart that declares no boundary as one part", () => {
    const odd = internetMessage(
      { From: "a@x.test", Subject: "s", "MIME-Version": "1.0", "Content-Type": "multipart/mixed" },
      "just text, no parts\r\n",
    );
    const read = readMessage(odd);
    assert.ok(read.notes.some((note) => /declares no boundary/.test(note)), JSON.stringify(read.notes));
  });

  test("keeps the quoted history of a reply, marked as quoted", () => {
    const read = readMessage(
      internetMessage(
        { From: "a@x.test", Subject: "Re: budget", "Content-Type": "text/plain" },
        "Oui, d'accord.\r\n\r\nLe 21 septembre, Paul a écrit :\r\n> et le budget ?\r\n> merci\r\n",
      ),
    );
    assert.match(read.body?.markdown ?? "", /^> et le budget \?$/m);
    assert.match(read.body?.markdown ?? "", /^> merci$/m);
  });
});

describe("readMessage: what it will not read", () => {
  test("refuses an S/MIME encrypted message as encrypted", () => {
    const encrypted = internetMessage(
      {
        From: "a@x.test",
        Subject: "chiffré",
        "MIME-Version": "1.0",
        "Content-Type": 'application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"',
        "Content-Transfer-Encoding": "base64",
      },
      "MIIBugYJKoZIhvcNAQcDoIIBqzCCAacCAQAxgg==\r\n",
    );
    assert.throws(() => readMessage(encrypted), (error: unknown) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.reason, "encrypted");
      assert.match(error.message, /S\/MIME-encrypted and no key is held/);
      return true;
    });
  });

  test("refuses a PGP message as encrypted", () => {
    const pgp = internetMessage(
      { From: "a@x.test", Subject: "pgp", "Content-Type": "text/plain" },
      "-----BEGIN PGP MESSAGE-----\r\nhQIMA/x\r\n-----END PGP MESSAGE-----\r\n",
    );
    assert.throws(() => readMessage(pgp), /PGP-encrypted/);
  });

  test("reads a signed message from the content the signature covers", () => {
    const signed = multipart(
      "sig1",
      [
        { headers: { "Content-Type": "text/plain" }, body: "Le contenu signé." },
        { headers: { "Content-Type": "application/pkcs7-signature", "Content-Transfer-Encoding": "base64" }, body: "MIIB" },
      ],
      { subtype: "signed" },
    );
    const read = readMessage(signed);
    assert.equal(read.signed, true);
    assert.match(read.body?.markdown ?? "", /Le contenu signé\./);
    assert.ok(read.notes.some((note) => /not verified/.test(note)), JSON.stringify(read.notes));
    // The signature part itself is not offered as a document to open.
    assert.deepEqual(read.attachments, []);
  });

  test("says an opaque signature hides the content, rather than reporting an empty body", () => {
    const opaque = internetMessage(
      {
        From: "a@x.test",
        Subject: "signé",
        "MIME-Version": "1.0",
        "Content-Type": 'application/pkcs7-mime; smime-type=signed-data; name="smime.p7m"',
        "Content-Transfer-Encoding": "base64",
      },
      "MIIBugYJKoZIhvcNAQcCoIIB\r\n",
    );
    const read = readMessage(opaque);
    assert.equal(read.signed, true);
    assert.equal(read.body, undefined);
    assert.match(read.bodyUnreadable?.reason ?? "", /opaque S\/MIME/);
    assert.ok((read.bodyUnreadable?.formsHeld ?? []).length > 0);
  });

  test("a body in no form it understands is reported, not returned empty", () => {
    const read = readMessage(
      multipart("odd1", [
        { headers: { "Content-Type": "application/x-unknown-body", "Content-Disposition": "inline" }, body: "\x01\x02" },
      ]),
    );
    assert.equal(read.body, undefined);
    assert.match(read.bodyUnreadable?.reason ?? "", /no body part/);
  });

  test("gives up inside the time budget rather than hanging", () => {
    const many = multipart(
      "big1",
      Array.from({ length: 200 }, (_, index) => ({
        headers: { "Content-Type": "text/plain" },
        body: `part ${index} ${"texte ".repeat(200)}`,
      })),
    );
    assert.throws(() => readMessage(many, { timeoutMs: 0 }), (error: unknown) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.reason, "budget");
      assert.match(error.message, /budget/);
      return true;
    });
  });

  test("refuses a message with an absurd number of parts", () => {
    const many = multipart(
      "bomb1",
      Array.from({ length: 600 }, () => ({ headers: { "Content-Type": "text/plain" }, body: "x" })),
    );
    assert.throws(() => readMessage(many), /more than 500 parts/);
  });
});
