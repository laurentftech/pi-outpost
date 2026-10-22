/**
 * Two versions of a cahier des charges with no tracked changes between them — what a
 * client sends when they revise a specification without Word's review mode. The input
 * of the docx_compare check in the running app (change docx-compare-with-word, 4.2).
 *
 *   node --import tsx/esm scripts/probes/make-cahier-des-charges.mts <dir>
 *
 * Between the two: an upload limit and a delay reworded, a format added, two-factor
 * authentication required, the delivery date brought forward, the CSV export removed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDocument } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { defaultWordTemplateBytes } from "@pi-outpost/office/defaultWordTemplate.ts";

const out = path.resolve(process.argv[2] ?? "cahier-des-charges");
mkdirSync(out, { recursive: true });

const v1 = `# Cahier des charges — Portail fournisseurs

Ce document décrit les exigences du portail par lequel les fournisseurs déposent leurs factures.

## Exigences fonctionnelles

### Dépôt des factures

Le fournisseur dépose une facture au format PDF. La taille maximale est de 10 Mo.

Chaque facture reçoit un accusé de réception par courriel sous 24 heures.

### Suivi des paiements

Le fournisseur consulte l'état de paiement de ses factures des 12 derniers mois.

Un export CSV de l'historique est disponible.

## Exigences non fonctionnelles

### Sécurité

L'authentification se fait par identifiant et mot de passe.

### Disponibilité

Le portail est disponible 99 % du temps, hors maintenance planifiée le dimanche.

## Délais

La mise en production est prévue 6 mois après la signature du contrat.
`;

const v2 = v1
  .replace("La taille maximale est de 10 Mo.", "La taille maximale est de 25 Mo, et le format XML Factur-X est accepté.")
  .replace("sous 24 heures", "sous 2 heures")
  .replace("\nUn export CSV de l'historique est disponible.\n", "")
  .replace("par identifiant et mot de passe.", "par identifiant et mot de passe, avec une authentification à deux facteurs obligatoire.")
  .replace("6 mois", "4 mois");

for (const [name, markdown] of [["cahier-des-charges-v1.docx", v1], ["cahier-des-charges-v2.docx", v2]] as const) {
  const { bytes } = await createDocument(readWordPackage(defaultWordTemplateBytes()), markdown);
  writeFileSync(path.join(out, name), bytes);
  console.log(path.join(out, name));
}
