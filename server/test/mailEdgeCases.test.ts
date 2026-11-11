/**
 * Mail shapes that are legal, or at least common, and that the main suite does not
 * send: RFC 2231 parameters, quoted strings with escapes, an emlx count line ending in
 * CRLF, a multipart that cannot be split, parts nested past the limit, a forwarded
 * message, an empty attachment, an HTML part with no text, an unknown character set and
 * an encrypted message. Each test checks what the agent would be handed.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MailError, parseAddresses, parseStructured, readMessage } from "../src/mail.ts";

const crlf = (lines: string[]) => Buffer.from(lines.join("\r\n"), "latin1");

describe("header parameters and addresses", () => {
  test("a charset-tagged RFC 2231 name is decoded, and a parameter with no value is skipped", () => {
    assert.deepEqual(parseStructured("attachment; filename*=utf-8''R%C3%A9sum%C3%A9.pdf; flag; size=3"), {
      value: "attachment",
      params: { filename: "Résumé.pdf", size: "3" },
    });
  });

  test("an RFC 2231 name without a charset tag is kept as written", () => {
    assert.deepEqual(parseStructured("attachment; filename*=plain.pdf").params, { filename: "plain.pdf" });
  });

  test("an escaped quote and a separator inside a quoted value stay in the value", () => {
    assert.deepEqual(parseStructured('text/plain; name="a\\"b;c.txt"; charset=utf-8').params, {
      name: 'a"b;c.txt',
      charset: "utf-8",
    });
  });

  test("a display name with a comma and escaped quotes is one mailbox", () => {
    assert.deepEqual(parseAddresses('"Doe, \\"JJ\\" John" <j@x.test>, plain@x.test'), [
      { name: 'Doe, "JJ" John', address: "j@x.test" },
      { address: "plain@x.test" },
    ]);
  });
});

describe("message structure", () => {
  test("an Apple Mail count line ending in CRLF still delimits the message from its property list", () => {
    const message = ["From: a@x.test", "To: b@x.test", "Subject: Hi", "", "Body text", ""].join("\n");
    const read = readMessage(Buffer.from(`${Buffer.byteLength(message)}\r\n${message}<?xml version="1.0"?><plist/>`));
    assert.equal(read.format, "emlx");
    assert.equal(read.subject, "Hi");
    assert.deepEqual(read.body, { markdown: "Body text", form: "plain text" }, "nothing of the plist reaches the body");
  });

  // Both used to say "read as a single part" and then report that the message carried no body.
  test("a multipart whose boundary never appears is read as its text, as the note says", () => {
    const read = readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/mixed; boundary=zzz", "", "just text, no delimiter", ""]));
    assert.deepEqual(read.notes, ["a multipart part's boundary was never found; it was read as a single part"]);
    assert.deepEqual(read.body, { markdown: "just text, no delimiter", form: "plain text" });
    assert.equal(read.bodyUnreadable, undefined);
  });

  test("a multipart that declares no boundary is read as its text, as the note says", () => {
    const read = readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/mixed", "", "text with no boundary", ""]));
    assert.deepEqual(read.notes, ["a multipart/mixed part declares no boundary; it was read as a single part"]);
    assert.deepEqual(read.body, { markdown: "text with no boundary", form: "plain text" });
  });

  test("parts nested past the limit are not read, and the reader is told", () => {
    let nested = "Content-Type: text/plain\r\n\r\ndeep\r\n";
    for (let level = 0; level < 25; level++) {
      nested = [`Content-Type: multipart/mixed; boundary=b${level}`, "", `--b${level}`, nested, `--b${level}--`, ""].join("\r\n");
    }
    const read = readMessage(Buffer.from(`From: a@x.test\r\nSubject: deep\r\n${nested}`, "latin1"));
    assert.ok(read.notes.includes("parts nested deeper than 20 were not read"), read.notes.join("; "));
    assert.equal(read.body, undefined, "the text past the limit is not invented");
  });

  test("a forwarded message is named by its own subject, and an empty attachment is said to be unreadable", () => {
    const read = readMessage(
      crlf([
        "From: a@x.test",
        "Subject: fwd",
        "Content-Type: multipart/mixed; boundary=m",
        "",
        "--m",
        "Content-Type: text/plain",
        "",
        "see attached",
        "--m",
        "Content-Type: message/rfc822",
        "",
        "Subject: =?UTF-8?Q?Caf=C3=A9?=",
        "From: c@x.test",
        "",
        "inner",
        "--m",
        "Content-Type: application/pdf; name=empty.pdf",
        "Content-Disposition: attachment; filename=empty.pdf",
        "Content-Transfer-Encoding: base64",
        "",
        "",
        "--m--",
        "",
      ]),
    );
    assert.deepEqual(read.body, { markdown: "see attached", form: "plain text" });
    const [forwarded, empty] = read.attachments;
    assert.equal(forwarded.mediaType, "message/rfc822");
    assert.equal(forwarded.messageSubject, "Café");
    assert.equal(forwarded.unreadable, undefined);
    assert.equal(empty.claimedName, "empty.pdf");
    assert.equal(empty.size, 0);
    assert.equal(empty.unreadable, "its content is empty or could not be decoded");
  });

  test("an HTML part with no text loses to the short plain part beside it", () => {
    const html = `<html><head><style>p{}</style></head><body>${"<div></div>".repeat(50)}</body></html>`;
    const read = readMessage(
      crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/alternative; boundary=a", "", "--a", "Content-Type: text/plain", "", "ok", "--a", "Content-Type: text/html", "", html, "--a--", ""]),
    );
    assert.deepEqual(read.body, { markdown: "ok", form: "plain text" });
  });

  test("a subject in a character set this runtime lacks is read as windows-1252, with a note", () => {
    const read = readMessage(crlf(["From: a@x.test", "Subject: =?x-nonexistent?Q?abc?=", "", "b", ""]));
    assert.equal(read.subject, "abc");
    assert.deepEqual(read.notes, ['character set "x-nonexistent" is not available here; that part was read as windows-1252']);
  });

  test("a PGP-encrypted message is refused with the reason, not read", () => {
    assert.throws(
      () =>
        readMessage(
          crlf([
            "From: a@x.test",
            'Content-Type: multipart/encrypted; boundary=e; protocol="application/pgp-encrypted"',
            "",
            "--e",
            "Content-Type: application/pgp-encrypted",
            "",
            "Version: 1",
            "--e--",
            "",
          ]),
        ),
      (error: unknown) => error instanceof MailError && error.reason === "encrypted" && /PGP-encrypted/.test(error.message),
    );
  });
});
