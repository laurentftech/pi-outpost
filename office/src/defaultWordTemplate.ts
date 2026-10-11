/**
 * The template a Word document is built from when the caller named none.
 *
 * Generated here rather than shipped as a file, for the reasons `defaultTemplate.ts`
 * gives for the PowerPoint one: a binary asset has to travel with every build, a
 * committed .dotx is opaque to review, and asking a local Word for a blank document
 * needs Office and returns style names in the user's language.
 *
 * It looks like Word's own blank document: Office's palette, Calibri Light headings
 * over Calibri body text, A4 portrait with 2.54 cm margins. The styles carry the
 * English names Word itself stores (`heading 1`, `Title`, `List Paragraph`,
 * `Table Grid`), which is what the Word mapping looks styles up by. It is not a
 * house style, and says which template it is (`DEFAULT_WORD_TEMPLATE_NAME`) so no
 * one mistakes it for one.
 */
import { writeZip } from "./zipWriter.ts";

/** What the tools call this template when they report which one they used. */
export const DEFAULT_WORD_TEMPLATE_NAME = "the built-in Word style";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

const BODY_FONT = "Calibri";
const HEADING_FONT = "Calibri Light";
/** Office's accent 1, darker: the colour Word gives its headings. */
const HEADING_COLOUR = "2F5496";

const fonts = (face: string) => `<w:rFonts w:ascii="${face}" w:hAnsi="${face}" w:eastAsia="${face}" w:cs="${face}"/>`;

/** A heading style as Word defines it: kept with what follows, in the outline at its level. */
function heading(level: number, halfPoints: number, before: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
    `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="0"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr>${fonts(HEADING_FONT)}<w:color w:val="${level <= 3 ? HEADING_COLOUR : "1F3763"}"/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>` +
    `</w:style>`
  );
}

const STYLES =
  XML +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults>` +
  `<w:rPrDefault><w:rPr>${fonts(BODY_FONT)}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/>` +
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
  `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr>` +
  `<w:rPr>${fonts(HEADING_FONT)}<w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/>` +
  `<w:rPr><w:color w:val="5A5A5A"/><w:spacing w:val="15"/></w:rPr></w:style>` +
  heading(1, 32, 240) +
  heading(2, 26, 40) +
  heading(3, 24, 40) +
  heading(4, 22, 40) +
  heading(5, 22, 40) +
  heading(6, 22, 40) +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>` +
  `<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:before="200" w:after="160"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="44546A"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>` +
  `<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `<w:tblPr><w:tblBorders>` +
  ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join("") +
  `</w:tblBorders></w:tblPr></w:style>` +
  `</w:styles>`;

/** A4 portrait, 2.54 cm margins: Word's blank page outside North America. */
const SECTION =
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>` +
  `<w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

const DOCUMENT = XML + `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${SECTION}</w:body></w:document>`;

const SETTINGS =
  XML +
  `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const CONTENT_TYPES =
  XML +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
  `</Types>`;

const ROOT_RELS = XML + `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS =
  XML +
  `<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${R}/settings" Target="settings.xml"/>` +
  `</Relationships>`;

/** The default template, as the bytes of a `.docx`. */
export function defaultWordTemplateBytes(): Buffer {
  return writeZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS) },
    { name: "word/document.xml", data: Buffer.from(DOCUMENT) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOCUMENT_RELS) },
    { name: "word/styles.xml", data: Buffer.from(STYLES) },
    { name: "word/settings.xml", data: Buffer.from(SETTINGS) },
  ]);
}
