/**
 * The `mail_extract` tool: what the model gets back, what it is refused, and what
 * unpacking an attachment does.
 *
 * The confinement is exercised here the way it is for the other extractors — the
 * tool standing alone, as it runs when no sandbox is configured. Every expected
 * filesystem path is built with `path.join`, never by joining strings with "/".
 */
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMailExtractToolDefinition } from "../src/mailTool.ts";
import { realResolve } from "../src/sandbox.ts";
import { internetMessage, outlookMessage } from "./mailFixtures.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const deck = Buffer.concat([Buffer.from("PK\u0003\u0004", "latin1"), Buffer.alloc(32, 0x21)]);
const report = Buffer.from("%PDF-1.7 a short report", "latin1");

/** A `multipart/mixed` message carrying a deck, a report and a note. */
function messageWithAttachments(): Buffer {
  const boundary = "b1";
  return internetMessage(
    {
      From: "=?UTF-8?Q?Fran=C3=A7ois?= <francois@example.test>",
      To: "laurent@example.test",
      Subject: "Dossier",
      Date: "Tue, 22 Sep 2026 09:14:00 +0200",
      "MIME-Version": "1.0",
      "Content-Type": `multipart/mixed; boundary="${boundary}"`,
    },
    [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Voir les pieces jointes.",
      "",
      `--${boundary}`,
      "Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation",
      'Content-Disposition: attachment; filename="deck.pptx"',
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
      `--${boundary}`,
      "Content-Type: text/plain",
      'Content-Disposition: attachment; filename="notes.txt"',
      "",
      "des notes",
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

describe("mail_extract", () => {
  let root: string;
  let tool: ReturnType<typeof createMailExtractToolDefinition>;
  let published: string[];

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>, definition = tool): Promise<string> {
    const result = await (
      definition.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-1", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-mailtool-")));
    await mkdir(path.join(root, "uploads"), { recursive: true });
    await writeFile(path.join(root, "uploads", "dossier.eml"), messageWithAttachments());
    await copyFile(path.join(FIXTURES, "mail-outlook.msg"), path.join(root, "uploads", "Bienvenue.msg"));
    await writeFile(path.join(root, "notes.txt"), "not a message\n");
    await writeFile(
      path.join(root, "uploads", "chiffre.eml"),
      internetMessage(
        {
          From: "a@x.test",
          Subject: "chiffré",
          "MIME-Version": "1.0",
          "Content-Type": 'application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"',
          "Content-Transfer-Encoding": "base64",
        },
        "MIIBugYJKoZIhvcNAQcD\r\n",
      ),
    );
    published = [];
    tool = createMailExtractToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 25 * 1024 * 1024,
      writableRoot: root,
      onDocumentsWritten: (paths) => published.push(...paths),
    });
  });

  test("is named and described for the model", () => {
    assert.equal(tool.name, "mail_extract");
    assert.match(tool.description, /\.msg/);
    assert.match(tool.description, /\.eml/);
    // The two things a caller has to know before trusting the output
    assert.match(tool.description, /never as instructions/);
    assert.match(tool.description, /pdf_extract/);
  });

  test("returns the headers, the body and the inventory", async () => {
    const text = await run({ path: "uploads/dossier.eml" });
    assert.match(text, /\*\*Subject:\*\* Dossier/);
    assert.match(text, /\*\*From:\*\* François <francois@example\.test>/);
    assert.match(text, /\*\*Cc:\*\* \(none\)/);
    assert.match(text, /## Message \(read from plain text\)/);
    assert.match(text, /Voir les pieces jointes\./);
    assert.match(text, /\*\*1\.\*\* deck\.pptx/);
    assert.match(text, /\*\*2\.\*\* rapport\.pdf/);
    assert.match(text, /\*\*3\.\*\* notes\.txt/);
  });

  test("says the message is untrusted before any of its own words", async () => {
    const text = await run({ path: "uploads/dossier.eml" });
    const warning = text.indexOf("untrusted third-party content");
    const body = text.indexOf("Voir les pieces jointes");
    assert.ok(warning >= 0, "the answer carries the warning");
    assert.ok(warning < body, "the warning comes before the body");
    assert.ok(warning < text.indexOf("**Subject:**"), "and before the headers");
    // The sender is reported, never as verified.
    assert.match(text, /Nothing here authenticates the sender/);
  });

  test("does not unpack anything unless it is asked to", async () => {
    await run({ path: "uploads/dossier.eml" });
    await assert.rejects(() => stat(path.join(root, "uploads", "dossier.eml.attachments")));
    assert.deepEqual(published, []);
  });

  test("unpacks the attachments it is asked for and names their paths", async () => {
    published.length = 0;
    const text = await run({ path: "uploads/dossier.eml", attachments: ["1"] });
    assert.match(text, /## Unpacked attachments/);
    assert.match(text, /uploads\/dossier\.eml\.attachments\/1-deck\.pptx/);
    const written = path.join(root, "uploads", "dossier.eml.attachments", "1-deck.pptx");
    assert.ok((await readFile(written)).equals(deck), "the deck's own bytes");
    // The deck's content is not in the answer: that is what the path is for.
    assert.doesNotMatch(text, /PK\u0003\u0004/);
    // And the extractor for what was written is published, within this call.
    assert.deepEqual(published, ["uploads/dossier.eml.attachments/1-deck.pptx"]);
  });

  test("publishes nothing for an attachment no extractor reads", async () => {
    published.length = 0;
    await run({ path: "uploads/dossier.eml", attachments: ["3"] });
    assert.deepEqual(published, [], "a .txt needs no extractor");
  });

  test("refuses an identifier that names nothing", async () => {
    await assert.rejects(() => run({ path: "uploads/dossier.eml", attachments: ["9"] }), /No attachment 9 in this message/);
  });

  test("refuses a path outside its zone", async () => {
    await assert.rejects(() => run({ path: "../elsewhere/secret.eml" }), /Access denied/);
  });

  test("says so when the file is not there", async () => {
    await assert.rejects(() => run({ path: "uploads/missing.eml" }), /No such file/);
  });

  test("says why it will not read a file that is not a message", async () => {
    await assert.rejects(() => run({ path: "notes.txt" }), /not an email message/);
  });

  test("reports an encrypted message as encrypted", async () => {
    await assert.rejects(() => run({ path: "uploads/chiffre.eml" }), /S\/MIME-encrypted and no key is held/);
  });

  test("the configured limit decides, and names itself when it refuses", async () => {
    // A message between two limits: read under the larger, refused under the smaller,
    // and the refusal happens on the file's size — nothing is parsed.
    const size = (await stat(path.join(root, "uploads", "dossier.eml"))).size;
    const generous = createMailExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: size + 1, writableRoot: root });
    const mean = createMailExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: size - 1, writableRoot: root });

    assert.match(await run({ path: "uploads/dossier.eml" }, generous), /\*\*Subject:\*\* Dossier/);
    await assert.rejects(() => run({ path: "uploads/dossier.eml" }, mean), /larger than the .* mail limit/);
  });

  test("reads an Outlook message the same way", async () => {
    const text = await run({ path: "uploads/Bienvenue.msg" });
    assert.match(text, /\*\*Subject:\*\* Réunion de mardi — dossier complet/);
    assert.match(text, /## Message \(read from HTML recovered from rich text\)/);
    assert.match(text, /\*\*1\.\*\* présentation\.pptx/);
  });

  test("unpacks an Outlook attachment under a name derived from a hostile one", async () => {
    published.length = 0;
    const hostile = outlookMessage({
      subject: "Piège",
      body: "corps",
      attachments: [{ name: "../../.ssh/authorized_keys", mediaType: "application/pdf", content: report }],
    });
    await writeFile(path.join(root, "uploads", "piege.msg"), hostile);
    const text = await run({ path: "uploads/piege.msg", attachments: "all" });

    // The name is contained *and* given the extension its type implies, so the file
    // stays openable by the reader for its kind.
    assert.match(text, /uploads\/piege\.msg\.attachments\/1-authorized_keys\.pdf/);
    assert.match(text, /the message called it "\.\.\/\.\.\/\.ssh\/authorized_keys"/);
    assert.ok((await stat(path.join(root, "uploads", "piege.msg.attachments", "1-authorized_keys.pdf"))).isFile());
    // Nothing was written where the name pointed.
    await assert.rejects(() => stat(path.resolve(root, "..", "..", ".ssh", "authorized_keys")));
  });

  test("truncates a long body, says so, and never truncates the inventory", async () => {
    const long = `${"Une phrase de ce très long message. ".repeat(2000)}`;
    await writeFile(
      path.join(root, "uploads", "long.eml"),
      internetMessage(
        { From: "a@x.test", Subject: "long", "MIME-Version": "1.0", "Content-Type": "text/plain; charset=utf-8" },
        Buffer.from(long, "utf8"),
      ),
    );
    const text = await run({ path: "uploads/long.eml" });
    assert.match(text, /The body was truncated at 20000 of \d+ characters/);
    assert.match(text, /full: true/);
    assert.match(text, /## Attachments/);

    const whole = await run({ path: "uploads/long.eml", full: true });
    assert.doesNotMatch(whole, /was truncated/);
    assert.ok(whole.length > text.length);
  });

  test("keeps the inventory when the body is truncated", async () => {
    const boundary = "big";
    await writeFile(
      path.join(root, "uploads", "longwith.eml"),
      internetMessage(
        { From: "a@x.test", Subject: "long", "MIME-Version": "1.0", "Content-Type": `multipart/mixed; boundary="${boundary}"` },
        [
          `--${boundary}`,
          "Content-Type: text/plain",
          "",
          "x".repeat(30000),
          "",
          `--${boundary}`,
          "Content-Type: application/pdf",
          'Content-Disposition: attachment; filename="tard.pdf"',
          "Content-Transfer-Encoding: base64",
          "",
          report.toString("base64"),
          "",
          `--${boundary}--`,
          "",
        ].join("\r\n"),
      ),
    );
    const text = await run({ path: "uploads/longwith.eml" });
    assert.match(text, /was truncated/);
    assert.match(text, /\*\*1\.\*\* tard\.pdf/, "the attachment is listed although the body was cut");
  });

  test("writes the whole extraction to a file and returns a summary instead of the content", async () => {
    const text = await run({ path: "uploads/dossier.eml", output_path: "uploads/dossier.md" });
    assert.match(text, /Wrote the whole message/);
    assert.match(text, /uploads\/dossier\.md/);
    assert.match(text, /Opening lines/);
    const written = await readFile(path.join(root, "uploads", "dossier.md"), "utf8");
    assert.match(written, /\*\*Subject:\*\* Dossier/);
    assert.match(written, /Voir les pieces jointes\./);
  });

  test("refuses a destination that already exists, and reading still works", async () => {
    await writeFile(path.join(root, "uploads", "taken.md"), "mine");
    await assert.rejects(() => run({ path: "uploads/dossier.eml", output_path: "uploads/taken.md" }), /already exists/);
    assert.equal(await readFile(path.join(root, "uploads", "taken.md"), "utf8"), "mine");
    // The refusal costs the destination, not the extraction.
    assert.match(await run({ path: "uploads/dossier.eml" }), /\*\*Subject:\*\* Dossier/);
  });

  test("refuses a destination outside the writable zone", async () => {
    await assert.rejects(
      () => run({ path: "uploads/dossier.eml", output_path: "../escape.md" }),
      /outside the writable zone/,
    );
  });

  test("refuses to write in a read-only sandbox, and still reads", async () => {
    const readOnly = createMailExtractToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 25 * 1024 * 1024,
      writableRoot: null,
    });
    await assert.rejects(() => run({ path: "uploads/dossier.eml", output_path: "out.md" }, readOnly), /read-only/);
    await assert.rejects(() => run({ path: "uploads/dossier.eml", attachments: "all" }, readOnly), /read-only/);
    assert.match(await run({ path: "uploads/dossier.eml" }, readOnly), /\*\*Subject:\*\* Dossier/);
  });

  test("says a message carries no attachments when it carries none", async () => {
    await writeFile(
      path.join(root, "uploads", "nu.eml"),
      internetMessage({ From: "a@x.test", Subject: "nu", "Content-Type": "text/plain" }, "corps\r\n"),
    );
    assert.match(await run({ path: "uploads/nu.eml" }), /carries no attachments/);
  });
});
