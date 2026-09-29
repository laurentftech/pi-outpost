/**
 * Unpacking a message's attachments: the names derived from hostile ones, and the
 * files written beside the message.
 *
 * Every expected path here is built with `path.join`/`path.resolve` and compared
 * after the same resolution the writer applies. A string built with `/` would pass
 * locally and fail on the Windows runners, which is the one mistake this file is
 * most likely to make.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { attachmentDirectoryFor, safeAttachmentName, unpackAttachments } from "../src/mailAttachments.ts";
import type { MailAttachment } from "../src/mail.ts";
import { realResolve } from "../src/sandbox.ts";

/** An attachment with only the fields the naming and writing care about. */
function attachment(fields: Partial<MailAttachment> & { id: string }): MailAttachment {
  return { mediaType: "application/octet-stream", size: 0, inline: false, ...fields };
}

describe("safeAttachmentName", () => {
  test("keeps the name and the extension, prefixed by the identifier", () => {
    assert.equal(
      safeAttachmentName(attachment({ id: "2", claimedName: "présentation du comité.pptx" })),
      "2-présentation du comité.pptx",
    );
  });

  test("contains a traversing name inside one component", () => {
    for (const claimed of [
      "../../.ssh/authorized_keys",
      "..\\..\\Windows\\System32\\hosts",
      "/etc/passwd",
      "C:\\Users\\lfran\\notes.txt",
    ]) {
      const name = safeAttachmentName(attachment({ id: "1", claimedName: claimed }));
      assert.doesNotMatch(name, /[/\\]/, claimed);
      assert.doesNotMatch(name, /\.\./, claimed);
    }
    // The extension still survives the containment, because it is how a reader is chosen.
    assert.equal(safeAttachmentName(attachment({ id: "1", claimedName: "../../deck.pptx" })), "1-deck.pptx");
  });

  test("replaces the characters Windows refuses and strips control characters", () => {
    assert.equal(safeAttachmentName(attachment({ id: "3", claimedName: 'a<b>c:"d|e?f*g.txt' })), "3-a_b_c__d_e_f_g.txt");
    assert.equal(safeAttachmentName(attachment({ id: "3", claimedName: "no\u0000tes\u001f.txt" })), "3-notes.txt");
  });

  test("strips the trailing dot Win32 would drop, which makes two names one file", () => {
    assert.equal(safeAttachmentName(attachment({ id: "1", claimedName: "rapport.pdf." })), "1-rapport.pdf");
    assert.equal(safeAttachmentName(attachment({ id: "1", claimedName: "rapport.pdf   " })), "1-rapport.pdf");
  });

  test("defuses a reserved device name", () => {
    assert.equal(safeAttachmentName(attachment({ id: "4", claimedName: "CON.txt" })), "4-_CON.txt");
    assert.equal(safeAttachmentName(attachment({ id: "4", claimedName: "lpt1" })), "4-_lpt1");
  });

  test("derives a name from the identifier and the media type when there is none", () => {
    assert.equal(safeAttachmentName(attachment({ id: "5", mediaType: "application/pdf" })), "5-attachment-5.pdf");
    assert.equal(safeAttachmentName(attachment({ id: "6", claimedName: "..", mediaType: "image/png" })), "6-attachment-6.png");
    assert.equal(safeAttachmentName(attachment({ id: "7", mediaType: "application/x-nonesuch" })), "7-attachment-7");
  });

  test("gives an extensionless name the extension its type implies", () => {
    assert.equal(
      safeAttachmentName(attachment({ id: "1", claimedName: "contrat", mediaType: "application/pdf" })),
      "1-contrat.pdf",
    );
  });

  test("truncates a very long name without losing its extension", () => {
    const name = safeAttachmentName(attachment({ id: "1", claimedName: `${"é".repeat(400)}.docx` }));
    assert.ok(Buffer.byteLength(name, "utf8") <= 200, `${Buffer.byteLength(name, "utf8")} bytes`);
    assert.ok(name.endsWith(".docx"));
    assert.ok(name.startsWith("1-é"));
  });
});

describe("attachmentDirectoryFor", () => {
  test("names a directory after the message, beside it", () => {
    assert.equal(attachmentDirectoryFor("uploads/Bienvenue.msg"), "uploads/Bienvenue.msg.attachments");
    assert.equal(attachmentDirectoryFor("mail.eml"), "mail.eml.attachments");
    // A Windows-shaped path the model may hand back is understood too.
    assert.equal(attachmentDirectoryFor("uploads\\Bienvenue.msg"), "uploads/Bienvenue.msg.attachments");
  });
});

describe("unpackAttachments", () => {
  let root: string;

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-mailunpack-")));
    await mkdir(path.join(root, "uploads"), { recursive: true });
  });

  const deck = Buffer.from("PK\u0003\u0004 a deck", "latin1");
  const report = Buffer.from("%PDF-1.7 a report", "latin1");

  test("writes the attachments beside the message, byte for byte", async () => {
    const results = await unpackAttachments(
      [
        attachment({ id: "1", claimedName: "deck.pptx", content: deck, size: deck.length }),
        attachment({ id: "2", claimedName: "rapport.pdf", content: report, size: report.length }),
      ],
      "all",
      { cwd: root, writableRoot: root, messagePath: "uploads/mail-a.msg" },
    );

    assert.deepEqual(
      results.map((result) => [result.id, result.path, result.bytes, result.error]),
      [
        ["1", "uploads/mail-a.msg.attachments/1-deck.pptx", deck.length, undefined],
        ["2", "uploads/mail-a.msg.attachments/2-rapport.pdf", report.length, undefined],
      ],
    );
    // Compared after the same resolution the writer applies — never by joining "/".
    const written = path.join(root, "uploads", "mail-a.msg.attachments", "1-deck.pptx");
    assert.ok((await stat(written)).isFile());
    assert.ok((await readFile(written)).equals(deck), "the bytes are the sender's bytes");
  });

  test("unpacks one attachment by its identifier", async () => {
    const results = await unpackAttachments(
      [
        attachment({ id: "1", claimedName: "deck.pptx", content: deck }),
        attachment({ id: "2", claimedName: "rapport.pdf", content: report }),
      ],
      ["2"],
      { cwd: root, writableRoot: root, messagePath: "uploads/mail-b.msg" },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].path, "uploads/mail-b.msg.attachments/2-rapport.pdf");
    // The one that was not asked for was not written.
    await assert.rejects(() => stat(path.join(root, "uploads", "mail-b.msg.attachments", "1-deck.pptx")));
  });

  test("refuses an identifier that names nothing", async () => {
    await assert.rejects(
      () =>
        unpackAttachments([attachment({ id: "1", claimedName: "a.pdf", content: report })], ["7"], {
          cwd: root,
          writableRoot: root,
          messagePath: "uploads/mail-c.msg",
        }),
      /No attachment 7 in this message\. It has 1: 1\./,
    );
  });

  test("two messages carrying the same name do not collide", async () => {
    const one = await unpackAttachments([attachment({ id: "1", claimedName: "report.pdf", content: report })], "all", {
      cwd: root,
      writableRoot: root,
      messagePath: "uploads/first.eml",
    });
    const two = await unpackAttachments([attachment({ id: "1", claimedName: "report.pdf", content: deck })], "all", {
      cwd: root,
      writableRoot: root,
      messagePath: "uploads/second.eml",
    });
    assert.equal(one[0].path, "uploads/first.eml.attachments/1-report.pdf");
    assert.equal(two[0].path, "uploads/second.eml.attachments/1-report.pdf");
    assert.ok((await readFile(path.join(root, "uploads", "first.eml.attachments", "1-report.pdf"))).equals(report));
    assert.ok((await readFile(path.join(root, "uploads", "second.eml.attachments", "1-report.pdf"))).equals(deck));
  });

  test("two attachments named alike inside one message both land", async () => {
    // Outlook names every inline image `image001.png`. The identifier prefix is what
    // keeps the second one from being refused for a reason of our own making.
    const results = await unpackAttachments(
      [
        attachment({ id: "1", claimedName: "image001.png", content: Buffer.from("one") }),
        attachment({ id: "2", claimedName: "image001.png", content: Buffer.from("two") }),
      ],
      "all",
      { cwd: root, writableRoot: root, messagePath: "uploads/inline.msg" },
    );
    assert.deepEqual(results.map((result) => result.writtenName), ["1-image001.png", "2-image001.png"]);
    assert.deepEqual(results.map((result) => result.error), [undefined, undefined]);
  });

  test("reports the written name beside the claimed one when they differ", async () => {
    const results = await unpackAttachments(
      [attachment({ id: "1", claimedName: "../../deck.pptx", content: deck })],
      "all",
      { cwd: root, writableRoot: root, messagePath: "uploads/hostile.msg" },
    );
    assert.equal(results[0].claimedName, "../../deck.pptx");
    assert.equal(results[0].writtenName, "1-deck.pptx");
    assert.equal(results[0].path, "uploads/hostile.msg.attachments/1-deck.pptx");
    // Nothing was written outside the attachment directory.
    await assert.rejects(() => stat(path.resolve(root, "..", "deck.pptx")));
  });

  test("leaves an existing file untouched and names it", async () => {
    const directory = path.join(root, "uploads", "twice.msg.attachments");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "1-rapport.pdf"), "mine, not the message's");

    const results = await unpackAttachments([attachment({ id: "1", claimedName: "rapport.pdf", content: report })], "all", {
      cwd: root,
      writableRoot: root,
      messagePath: "uploads/twice.msg",
    });
    assert.match(results[0].error ?? "", /already exists and was left untouched/);
    assert.match(results[0].error ?? "", /twice\.msg\.attachments\/1-rapport\.pdf/);
    assert.equal(await readFile(path.join(directory, "1-rapport.pdf"), "utf8"), "mine, not the message's");
  });

  test("refuses to write anything when the sandbox is read-only", async () => {
    await assert.rejects(
      () =>
        unpackAttachments([attachment({ id: "1", claimedName: "a.pdf", content: report })], "all", {
          cwd: root,
          writableRoot: null,
          messagePath: "uploads/readonly.msg",
        }),
      /read-only/,
    );
    await assert.rejects(() => stat(path.join(root, "uploads", "readonly.msg.attachments")), "no directory was created");
  });

  test("refuses a destination outside the writable zone", async () => {
    const inner = path.join(root, "writable");
    await mkdir(inner, { recursive: true });
    await assert.rejects(
      () =>
        unpackAttachments([attachment({ id: "1", claimedName: "a.pdf", content: report })], "all", {
          cwd: root,
          writableRoot: inner,
          messagePath: "uploads/outside.msg",
        }),
      /outside the writable zone/,
    );
  });

  test("writes a nameless attachment under a name derived from its identifier and type", async () => {
    const results = await unpackAttachments(
      [attachment({ id: "1", mediaType: "application/pdf", content: report })],
      "all",
      { cwd: root, writableRoot: root, messagePath: "uploads/nameless.eml" },
    );
    assert.equal(results[0].writtenName, "1-attachment-1.pdf");
    assert.equal(results[0].path, "uploads/nameless.eml.attachments/1-attachment-1.pdf");
    // And it really is there under that name, openable by the reader for its type.
    assert.ok((await readFile(path.join(root, "uploads", "nameless.eml.attachments", "1-attachment-1.pdf"))).equals(report));
  });

  test("lists an attachment with no content as unwritten, with the reason", async () => {
    const results = await unpackAttachments(
      [
        attachment({ id: "1", claimedName: "vide.pdf", unreadable: "its content is not stored in this file" }),
        attachment({ id: "2", claimedName: "bon.pdf", content: report }),
      ],
      "all",
      { cwd: root, writableRoot: root, messagePath: "uploads/partial.msg" },
    );
    assert.equal(results[0].path, undefined);
    assert.match(results[0].error ?? "", /not stored in this file/);
    // One bad attachment must not cost the good one.
    assert.equal(results[1].path, "uploads/partial.msg.attachments/2-bon.pdf");
  });
});
