/**
 * `server/test/fixtures/docx-review-desktop.docx`: tracked changes only desktop Word
 * records reliably (change docx-revisions-and-comments, task 1.1). Windows with Word.
 *
 *   node --import tsx/esm scripts/probes/make-docx-review-desktop.mts [out.docx]
 *
 * The base is written by this repository's builder, so its text is known exactly. Desktop
 * Word then opens it with tracking on and makes four edits, each by its own author:
 *
 * - Alice moves the paragraph "Les factures sont archivées dix ans." from "Exigences" to
 *   "Exploitation" (cut and paste of the whole paragraph: Word records a move);
 * - Bruno restyles the heading "Contexte réglementaire" to body text;
 * - Bruno removes the strikethrough on "le paiement par chèque";
 * - Chloé comments on "dix ans", Alice and Bruno reply, and the thread is marked resolved.
 *
 * Word's user name, and the option that makes Word use it over the signed-in account,
 * are set for each author and restored afterwards: they are the user's own Office settings.
 */
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocument } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { defaultWordTemplateBytes } from "@pi-outpost/office/defaultWordTemplate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "server", "test", "fixtures", "docx-review-desktop.docx"));
const work = mkdtempSync(path.join(os.tmpdir(), "pi-outpost-review-desktop-"));
const target = path.join(work, "review.docx");

const markdown = `# Portail fournisseurs

## Exigences

Le fournisseur dépose ses factures au format PDF.

Les factures sont archivées dix ans.

## Contexte réglementaire

La facturation électronique devient obligatoire.

## Exploitation

Le portail accepte ~~le paiement par chèque~~ et le virement.

Les sauvegardes sont quotidiennes.
`;
const { bytes } = await createDocument(readWordPackage(defaultWordTemplateBytes()), markdown);
writeFileSync(target, bytes);

const script = String.raw`
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Word.Application
$app.DisplayAlerts = 0
$userName = $app.UserName; $userInitials = $app.UserInitials; $localInfo = $app.Options.UseLocalUserInfo
# Signed in to Office, Word signs revisions with the account unless told to use these.
$app.Options.UseLocalUserInfo = $true
function Step($m) { [Console]::Out.WriteLine("step: $m") }
function As($name, $initials) { $app.UserName = $name; $app.UserInitials = $initials }
function Para($doc, $text) {
  foreach ($p in $doc.Paragraphs) { if ($p.Range.Text.TrimEnd([char]13) -eq $text) { return $p } }
  throw "no paragraph reads: $text"
}
$doc = $null
try {
  $doc = $app.Documents.Open($env:REVIEW_TARGET, $false, $false, $false)
  Step 'opened'
  $doc.TrackRevisions = $true
  $doc.TrackFormatting = $true
  $doc.TrackMoves = $true

  As 'Alice Martin' 'AM'
  $moved = Para $doc 'Les factures sont archivées dix ans.'
  $moved.Range.Cut()
  $anchor = Para $doc 'Les sauvegardes sont quotidiennes.'
  $at = $anchor.Range.Duplicate; $at.Collapse(1)
  $at.Paste()
  Step "moved; revisions=$($doc.Revisions.Count)"

  As 'Bruno Petit' 'BP'
  $heading = Para $doc 'Contexte réglementaire'
  $heading.Range.Style = -1  # wdStyleNormal
  Step "restyled; revisions=$($doc.Revisions.Count)"
  $struck = (Para $doc 'Le portail accepte le paiement par chèque et le virement.').Range
  $find = $struck.Duplicate
  if ($find.Find.Execute('le paiement par chèque')) { $find.Font.StrikeThrough = $false }
  Step "unstruck; revisions=$($doc.Revisions.Count)"

  As 'Chloé Durand' 'CD'
  $archived = (Para $doc 'Les factures sont archivées dix ans.').Range.Duplicate
  $null = $archived.Find.Execute('dix ans')
  $comment = $doc.Comments.Add($archived, 'Dix ans, ou la durée légale ?')
  As 'Alice Martin' 'AM'
  $null = $comment.Replies.Add($comment.Scope, 'Dix ans est la durée légale.')
  As 'Bruno Petit' 'BP'
  $null = $comment.Replies.Add($comment.Scope, 'D''accord, je clos.')
  $comment.Done = $true
  Step "commented; comments=$($doc.Comments.Count)"

  $doc.Save()
  Step 'saved'
} finally {
  $app.UserName = $userName; $app.UserInitials = $userInitials; $app.Options.UseLocalUserInfo = $localInfo
  if ($doc -ne $null) { $doc.Close(0) }
  $app.Quit([ref]0)
}
`;

await new Promise<void>((resolve, reject) => {
  const child = execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, REVIEW_TARGET: target }, timeout: 120_000, windowsHide: true },
    (error, stdout, stderr) => {
      process.stdout.write(stdout);
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve();
    },
  );
  void child;
});
copyFileSync(target, out);
console.log(`written: ${out}`);
