/**
 * Builds the Word packages the template and update tests start from.
 *
 * Written by hand, like the other Office fixtures, because the tests assert things
 * about the markup that only a package under our control can promise:
 *
 * - `docx-template.dotx` — a template as a French Word install writes one: heading
 *   styles with localized ids (`Titre1`) and built-in English names (`heading 1`),
 *   numbered through a numbering definition of the template's own; a cover page and
 *   a table of contents as content controls; a header and a footer; custom margins;
 *   sample text whose picture nothing else uses; and a template (not document) main
 *   part the output must turn into a document.
 * - `docx-report.docx` — a document to update: sections 1, 2 (with 2.1 and 2.2) and
 *   3, a list, a table, a picture in section 3, a comment and a bookmark in section 2.
 * - `docx-report-tracked.docx` — the same, with an unaccepted insertion in 2.1.
 *
 * The zip is written here too, so this needs nothing installed.
 *
 *   node server/test/fixtures/make-docx-template.mjs
 */
import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const T = (name) => `${R}/${name}`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const CT = (name) => `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`;

function zip(entries) {
  const chunks = [];
  const files = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const body = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);
    files.push({ nameBytes, crc: crc32(raw), size: raw.length, compressed: body.length, offset });
    offset += local.length + nameBytes.length + body.length;
  }
  const central = [];
  for (const file of files) {
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(file.crc, 16);
    entry.writeUInt32LE(file.compressed, 20);
    entry.writeUInt32LE(file.size, 24);
    entry.writeUInt16LE(file.nameBytes.length, 28);
    entry.writeUInt32LE(file.offset, 42);
    central.push(entry, file.nameBytes);
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBytes, end]);
}

/** A 2×1 PNG, red then blue. */
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const picture = (rid, name) =>
  `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="${name}"/>` +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const styles = `${XML}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titre3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/><w:color w:val="2F5496"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titre"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Paragraphedeliste"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="En-tte"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="character" w:default="1" w:styleId="Policepardfaut"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableauNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="Grilledutableau"><w:name w:val="Table Grid"/><w:basedOn w:val="TableauNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="Aucuneliste"><w:name w:val="No List"/><w:semiHidden/></w:style>
</w:styles>`;

const numbering = `${XML}<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Titre1"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Titre2"/><w:lvlText w:val="%1.%2."/><w:lvlJc w:val="left"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const settings = `${XML}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:decimalSymbol w:val=","/><w:listSeparator w:val=";"/></w:settings>`;

const header = `${XML}<w:hdr xmlns:w="${W}">${para("Société Exemple — confidentiel", "En-tte")}</w:hdr>`;
const footer = `${XML}<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
const theme = `${XML}<a:theme xmlns:a="${A}" name="Exemple"><a:themeElements><a:clrScheme name="Exemple"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="2F5496"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Exemple"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Exemple"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>`;

const cover =
  `<w:sdt><w:sdtPr><w:id w:val="101"/><w:docPartObj><w:docPartGallery w:val="Cover Pages"/><w:docPartUnique/></w:docPartObj></w:sdtPr>` +
  `<w:sdtContent>${para("Rapport annuel", "Titre")}<w:p><w:r><w:br w:type="page"/></w:r></w:p></w:sdtContent></w:sdt>`;
const toc =
  `<w:sdt><w:sdtPr><w:id w:val="102"/><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr>` +
  `<w:sdtContent><w:p><w:r><w:t>Sommaire</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Mettez à jour la table.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>`;

const docRoot = (body) =>
  `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>${body}</w:body></w:document>`;

const documentRels = (extra = "") =>
  `${XML}<Relationships xmlns="${REL}">` +
  `<Relationship Id="rIdStyles" Type="${T("styles")}" Target="styles.xml"/>` +
  `<Relationship Id="rIdNumbering" Type="${T("numbering")}" Target="numbering.xml"/>` +
  `<Relationship Id="rIdSettings" Type="${T("settings")}" Target="settings.xml"/>` +
  `<Relationship Id="rIdTheme" Type="${T("theme")}" Target="theme/theme1.xml"/>` +
  `<Relationship Id="rIdHeader" Type="${T("header")}" Target="header1.xml"/>` +
  `<Relationship Id="rIdFooter" Type="${T("footer")}" Target="footer1.xml"/>` +
  extra +
  `</Relationships>`;

function contentTypes(main, extra = "") {
  return (
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/word/document.xml" ContentType="${main}"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${CT("styles")}"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="${CT("numbering")}"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${CT("settings")}"/>` +
    `<Override PartName="/word/header1.xml" ContentType="${CT("header")}"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="${CT("footer")}"/>` +
    `<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    extra +
    `</Types>`
  );
}

const rootRels =
  `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${T("officeDocument")}" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Modèle</dc:title></cp:coreProperties>`;

const common = {
  "_rels/.rels": rootRels,
  "docProps/core.xml": core,
  "word/styles.xml": styles,
  "word/numbering.xml": numbering,
  "word/settings.xml": settings,
  "word/theme/theme1.xml": theme,
  "word/header1.xml": header,
  "word/footer1.xml": footer,
};

const templateBody =
  cover +
  toc +
  para("Titre de section", "Titre1") +
  para("Remplacez ce texte d’exemple par le vôtre.") +
  picture("rIdSample", "exemple.png") +
  para("Sous-partie d’exemple", "Titre2") +
  para("Encore du texte d’exemple.") +
  sectPr;

await writeFile(
  path.join(HERE, "docx-template.dotx"),
  zip({
    "[Content_Types].xml": contentTypes(CT("template.main")),
    ...common,
    "word/_rels/document.xml.rels": documentRels(`<Relationship Id="rIdSample" Type="${T("image")}" Target="media/exemple.png"/>`),
    "word/document.xml": docRoot(templateBody),
    "word/media/exemple.png": png(),
  }),
);

/* ── A document to update ───────────────────────────────────────────────────── */

const bookmark = `<w:bookmarkStart w:id="0" w:name="scope"/><w:bookmarkEnd w:id="0"/>`;
function reportBody(trackedInsertion) {
  return (
    para("Rapport de projet", "Titre") +
    para("Introduction", "Titre1") +
    para("Ce rapport présente le projet.") +
    para("Périmètre", "Titre1") +
    `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${bookmark}<w:commentRangeStart w:id="1"/><w:r><w:t>Le périmètre couvre deux lots.</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>` +
    para("Inclus", "Titre2") +
    (trackedInsertion
      ? `<w:p><w:ins w:id="5" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Ajout non accepté.</w:t></w:r></w:ins></w:p>`
      : para("Le lot A et le lot B.")) +
    `<w:p><w:pPr><w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Lot A</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Lot B</w:t></w:r></w:p>` +
    para("Exclus", "Titre2") +
    `<w:tbl><w:tblPr><w:tblStyle w:val="Grilledutableau"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>` +
    `<w:tr><w:tc><w:p><w:r><w:t>Lot</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Raison</w:t></w:r></w:p></w:tc></w:tr>` +
    `<w:tr><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Hors budget</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
    para("Risques", "Titre1") +
    para("Un risque de délai.") +
    picture("rIdRisk", "risque.png") +
    para("Conclusion", "Titre1") +
    para("Le projet avance.") +
    sectPr
  );
}

const reportNumbering = numbering.replace(
  "<w:num w:numId=\"1\">",
  `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1">`,
).replace("</w:numbering>", `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);

const comments = `${XML}<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Bob" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>À préciser.</w:t></w:r></w:p></w:comment></w:comments>`;

for (const [file, tracked] of [
  ["docx-report.docx", false],
  ["docx-report-tracked.docx", true],
]) {
  await writeFile(
    path.join(HERE, file),
    zip({
      "[Content_Types].xml": contentTypes(CT("document.main"), `<Override PartName="/word/comments.xml" ContentType="${CT("comments")}"/>`),
      ...common,
      "word/numbering.xml": reportNumbering,
      "word/comments.xml": comments,
      "word/_rels/document.xml.rels": documentRels(
        `<Relationship Id="rIdRisk" Type="${T("image")}" Target="media/risque.png"/><Relationship Id="rIdComments" Type="${T("comments")}" Target="comments.xml"/>`,
      ),
      "word/document.xml": docRoot(reportBody(tracked)),
      "word/media/risque.png": png(),
    }),
  );
}
console.log("wrote docx-template.dotx, docx-report.docx, docx-report-tracked.docx");
