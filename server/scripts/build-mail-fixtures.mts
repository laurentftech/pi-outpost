/**
 * Writes the committed mail fixtures.
 *
 * The suites build most of their messages in memory (see `test/mailFixtures.ts`),
 * which keeps each case legible. These two exist as files because they stand for
 * something a built message cannot: bytes that came from disk, checked out through
 * git, on whichever platform the tests run. The `.msg` proves the reader survives a
 * round trip through a binary blob and a Windows checkout; the `.eml` proves the
 * parser tolerates the line endings git hands it.
 *
 *   npx tsx server/scripts/build-mail-fixtures.mts
 *
 * Re-run it after changing the writer, and commit what changes.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compressRtf, internetMessage, outlookMessage } from "../test/mailFixtures.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

/** A deck and a report, small but real enough that a reader can tell them apart. */
const deck = Buffer.concat([Buffer.from("PK\u0003\u0004", "latin1"), Buffer.alloc(64, 0x21)]);
const report = Buffer.from("%PDF-1.7\n% a very short report\n", "latin1");

const encapsulated = String.raw`{\rtf1\ansi\ansicpg1252\fromhtml1 \htmlrtf {\htmlrtf0 {\*\htmltag84 <html>}{\*\htmltag84 <body>}{\*\htmltag112 <p>}Bonjour,{\*\htmltag116 </p>}{\*\htmltag112 <p>}Voici la \htmlrtf\b\htmlrtf0 {\*\htmltag84 <b>}pr\'e9sentation{\*\htmltag92 </b>}\htmlrtf\b0\htmlrtf0  et le rapport.{\*\htmltag116 </p>}{\*\htmltag88 </body>}{\*\htmltag88 </html>}}}`;

const outlook = outlookMessage({
  subject: "Réunion de mardi — dossier complet",
  // No plain-text property: this fixture's body is the encapsulated-HTML path, which
  // is the one a real Outlook message with formatting takes.
  bodyRtfCompressed: compressRtf(encapsulated),
  senderName: "François Girard",
  senderEmail: "francois.girard@example.test",
  recipients: [
    { name: "Laurent", address: "laurent@example.test", type: 1 },
    { name: "Comité", address: "comite@example.test", type: 2 },
  ],
  transportHeaders:
    "Received: from mail.example.test\r\nDate: Tue, 22 Sep 2026 09:14:00 +0200\r\nFrom: François Girard <francois.girard@example.test>\r\nSubject: =?UTF-8?Q?R=C3=A9union_de_mardi?=\r\n",
  attachments: [
    { name: "présentation.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", content: deck },
    { name: "rapport.pdf", mediaType: "application/pdf", content: report },
    { name: "notes.txt", mediaType: "text/plain", content: Buffer.from("trois lignes de notes\n", "utf8") },
  ],
});

const boundary = "----=_Part_42_1695371640";
const thread = internetMessage(
  {
    From: "=?UTF-8?Q?Fran=C3=A7ois_Girard?= <francois.girard@example.test>",
    To: "Laurent <laurent@example.test>",
    Cc: "comite@example.test",
    Subject: "=?UTF-8?Q?R=C3=A9union_de_mardi?= =?UTF-8?Q?_=E2=80=94_dossier?=",
    Date: "Tue, 22 Sep 2026 09:14:00 +0200",
    "Message-ID": "<thread-1@example.test>",
    "MIME-Version": "1.0",
    "Content-Type": `multipart/mixed; boundary="${boundary}"`,
  },
  [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Bonjour,",
    "",
    "Voici la pr=C3=A9sentation et le rapport.",
    "",
    "Le 21 septembre, Paul a =C3=A9crit :",
    "> et le budget ?",
    "",
    `--${boundary}`,
    "Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation",
    'Content-Disposition: attachment; filename="=?UTF-8?Q?pr=C3=A9sentation.pptx?="',
    "Content-Transfer-Encoding: base64",
    "",
    deck.toString("base64"),
    "",
    `--${boundary}`,
    "Content-Type: application/pdf",
    'Content-Disposition: attachment; filename="rapport.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    report.toString("base64"),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n"),
);

await writeFile(path.join(FIXTURES, "mail-outlook.msg"), outlook);
await writeFile(path.join(FIXTURES, "mail-thread.eml"), thread);
console.log(`wrote mail-outlook.msg (${outlook.length} bytes) and mail-thread.eml (${thread.length} bytes)`);
