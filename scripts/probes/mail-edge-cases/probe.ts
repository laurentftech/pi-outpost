// What readMessage, parseStructured and parseAddresses make of unusual but real mail shapes.
// Run: node --import tsx scripts/probes/mail-edge-cases/probe.ts
import { parseAddresses, parseStructured, readMessage } from "../../../server/src/mail.ts";
const crlf = (lines: string[]) => Buffer.from(lines.join("\r\n"), "latin1");
const show = (label: string, run: () => unknown) => {
  try { console.log(label, JSON.stringify(run(), (k, v) => (k === "content" ? `<${v?.data?.length ?? v?.length} bytes>` : v))); }
  catch (e) { console.log(label, "THROWS", (e as Error).name, (e as Error).message); }
};
show("ext tagged", () => parseStructured(`attachment; filename*=utf-8''R%C3%A9sum%C3%A9.pdf; flag; size=3`));
show("ext untagged", () => parseStructured(`attachment; filename*=plain.pdf`));
show("quoted escape", () => parseStructured(`text/plain; name="a\\"b;c.txt"; charset=utf-8`));
show("addresses", () => parseAddresses(`"Doe, \\"JJ\\" John" <j@x.test>, plain@x.test`));
const simple = ["From: a@x.test", "To: b@x.test", "Subject: Hi", "", "Body text", ""].join("\n");
show("emlx crlf", () => readMessage(Buffer.from(`${Buffer.byteLength(simple)}\r\n${simple}<?xml plist?>`)));
show("emlx overrun", () => readMessage(Buffer.from(`99999\n${simple}`)));
let nested = crlf(["Content-Type: text/plain", "", "deep", ""]).toString("latin1");
for (let i = 0; i < 40; i++) nested = ["Content-Type: multipart/mixed; boundary=b" + i, "", "--b" + i, nested, "--b" + i + "--", ""].join("\r\n");
show("deep", () => { const m = readMessage(Buffer.from(["From: a@x.test", "Subject: deep", nested].join("\r\n"), "latin1")); return { notes: m.notes, body: m.body }; });
show("no boundary found", () => { const m = readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/mixed; boundary=zzz", "", "just text, no delimiter", ""])); return { notes: m.notes, body: m.body, bu: m.bodyUnreadable }; });
show("encrypted", () => readMessage(crlf(["From: a@x.test", "Content-Type: multipart/encrypted; boundary=e; protocol=\"application/pgp-encrypted\"", "", "--e", "Content-Type: application/pgp-encrypted", "", "Version: 1", "--e--", ""])));
show("rfc822 + empty", () => { const m = readMessage(crlf(["From: a@x.test", "Subject: fwd", "Content-Type: multipart/mixed; boundary=m", "", "--m", "Content-Type: text/plain", "", "see attached", "--m", "Content-Type: message/rfc822", "", "Subject: =?UTF-8?Q?Caf=C3=A9?=", "From: c@x.test", "", "inner", "--m", "Content-Type: application/pdf; name=empty.pdf", "Content-Disposition: attachment; filename=empty.pdf", "Content-Transfer-Encoding: base64", "", "", "--m--", ""])); return { body: m.body, att: m.attachments.map((a) => ({ name: a.claimedName, subject: a.messageSubject, size: a.size, unreadable: a.unreadable })) }; });
show("stub vs empty html", () => readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/alternative; boundary=a", "", "--a", "Content-Type: text/plain", "", "", "--a", "Content-Type: text/html", "", "<p> </p><img src=x>", "--a--", ""])).body);
show("html empty plain short", () => readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/alternative; boundary=a", "", "--a", "Content-Type: text/plain", "", "ok", "--a", "Content-Type: text/html", "", "<html><head><style>p{}</style></head><body>"+"<div></div>".repeat(50)+"</body></html>", "--a--", ""])).body);
show("unknown charset subject", () => readMessage(crlf(["From: a@x.test", "Subject: =?x-nonexistent?Q?abc?=", "", "b", ""])).notes);
show("no boundary declared", () => { const m = readMessage(crlf(["From: a@x.test", "Subject: s", "Content-Type: multipart/mixed", "", "text with no boundary param", ""])); return { notes: m.notes, body: m.body, bu: m.bodyUnreadable }; });
