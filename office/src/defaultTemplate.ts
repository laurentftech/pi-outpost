/**
 * The template a deck is built from when the user named none.
 *
 * `pptx_create` copies its masters, layouts and theme from a template — it cannot
 * invent them (see pptxBuild.ts). So "make me a deck on the default theme", with no
 * file in the workspace, had no answer at all: the parameter was required, nothing
 * shipped one, and the only .potx in the repository were test fixtures. A model asked
 * for exactly that went looking for "template" in the codebase and found those, which
 * is the worst of the outcomes available to it.
 *
 * Generated here rather than shipped as a file, for three reasons. A binary asset has
 * to be embedded in the standalone executable too, and a build that forgets it fails
 * only once distributed. A committed .potx is opaque to review. And asking the local
 * PowerPoint for a blank deck — the obvious alternative — needs a shell the sandbox may
 * not grant, needs Office, so never works on Linux or in CI, and returns layouts named
 * in the user's Office language: a French PowerPoint calls them "Diapositive de titre"
 * and "Deux contenus", so nothing that names a layout in English would match.
 *
 * The theme is Office's own — its palette, and Calibri Light over Calibri — so a deck
 * built without a template looks like a deck built from PowerPoint's default, which is
 * what the user asking for "the default theme" means. It is not a house style, and the
 * tools say which template they used precisely so nobody mistakes it for one.
 */
import { writeZip, type ZipInput } from "./zipWriter.ts";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const T = (name: string): string => `${R}/${name}`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

/** What the tools call this template when they report which one they used. */
export const DEFAULT_TEMPLATE_NAME = "the built-in Office theme";

const rels = (list: Array<[string, string, string]>): string =>
  `${XML}<Relationships xmlns="${REL}">` +
  list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${T(type)}" Target="${target}"/>`).join("") +
  `</Relationships>`;

const xfrm = (x: number, y: number, cx: number, cy: number): string =>
  `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

/**
 * A placeholder shape. `box` omitted means it inherits the master's position.
 *
 * `text` overrides the inherited list style. A subtitle, a caption and a section's
 * text are prose, not a list, and every one of them inherits the master's bullet
 * unless it says otherwise — which is how a cover slide ends up with a bullet in
 * front of its subtitle. Office's own layouts turn it off on exactly these three.
 */
const ph = (id: number, name: string, attrs: string, box?: string, text?: { anchor?: string; list?: string }): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr><p:ph${attrs}/></p:nvPr></p:nvSpPr><p:spPr>${box ?? ""}</p:spPr>` +
  `<p:txBody><a:bodyPr${text?.anchor === undefined ? "" : ` anchor="${text.anchor}"`}/>` +
  `<a:lstStyle>${text?.list ?? ""}</a:lstStyle><a:p/></p:txBody></p:sp>`;

/** Prose, not a list: no bullet, no hanging indent. */
const PROSE = (size: number): string =>
  `<a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="${size}">` +
  `<a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr>`;

const tree = (shapes: string): string =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `${shapes}</p:spTree>`;

const layoutPart = (name: string, type: string, shapes: string): string =>
  `${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="${type}" preserve="1">` +
  `<p:cSld name="${name}">${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/**
 * The layouts PowerPoint's own default deck offers, under the names it gives them.
 * The names are the contract: the skill tells the model to pick a layout by name, and
 * these are the English ones it knows. Geometry is the 16:9 slide PowerPoint uses.
 */
const LAYOUTS: Array<[string, string, string]> = [
  [
    "Title Slide",
    "title",
    // The title sits on the subtitle, as PowerPoint's own cover does: anchored to the
    // bottom of its box, so the pair reads as one block however long the title runs.
    ph(2, "Title", ' type="ctrTitle"', xfrm(1524000, 1122363, 9144000, 2387600), { anchor: "b" }) +
      ph(3, "Subtitle", ' type="subTitle" idx="1"', xfrm(1524000, 3602038, 9144000, 1655762), { list: PROSE(2400) }),
  ],
  ["Title and Content", "obj", ph(2, "Title", ' type="title"') + ph(3, "Content", ' idx="1"')],
  [
    "Two Content",
    "twoObj",
    ph(2, "Title", ' type="title"') +
      ph(3, "Left", ' sz="half" idx="1"', xfrm(838200, 1825625, 5181600, 4351338)) +
      ph(4, "Right", ' sz="half" idx="2"', xfrm(6172200, 1825625, 5181600, 4351338)),
  ],
  [
    "Picture with Caption",
    "picTx",
    ph(2, "Title", ' type="title"', xfrm(839788, 457200, 3932237, 1600200)) +
      ph(3, "Picture", ' type="pic" idx="1"', xfrm(5183188, 987425, 6172200, 4873625)) +
      ph(4, "Caption", ' type="body" sz="half" idx="2"', xfrm(839788, 2057400, 3932237, 3811588), { list: PROSE(1400) }),
  ],
  [
    "Section Header",
    "secHead",
    ph(2, "Title", ' type="title"', xfrm(831850, 1709738, 10515600, 2852737), { anchor: "b" }) +
      ph(3, "Text", ' type="body" idx="1"', xfrm(831850, 4589463, 10515600, 1500187), { list: PROSE(1800) }),
  ],
  ["Title Only", "titleOnly", ph(2, "Title", ' type="title"')],
  ["Blank", "blank", ""],
];

const MASTER =
  `${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>` +
  `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
  tree(
    ph(2, "Title Placeholder", ' type="title"', xfrm(838200, 365125, 10515600, 1325563)) +
      ph(3, "Text Placeholder", ' type="body" idx="1"', xfrm(838200, 1825625, 10515600, 4351338)),
  ) +
  `</p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"` +
  ` accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst>${LAYOUTS.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldLayoutIdLst>` +
  `<p:txStyles>` +
  `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
  `<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
  `<p:bodyStyle>` +
  `<a:lvl1pPr marL="228600" indent="-228600" algn="l"><a:buChar char="•"/><a:defRPr sz="2800" kern="1200">` +
  `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>` +
  `<a:lvl2pPr marL="685800" indent="-228600" algn="l"><a:buChar char="–"/><a:defRPr sz="2400" kern="1200">` +
  `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl2pPr>` +
  `<a:lvl3pPr marL="1143000" indent="-228600" algn="l"><a:buChar char="•"/><a:defRPr sz="2000" kern="1200">` +
  `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl3pPr>` +
  `</p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`;

const color = (name: string, value: string): string => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;

/**
 * Office's own theme values: the palette a blank PowerPoint deck carries, and its
 * Calibri Light / Calibri pair. Written out rather than read from an installed Office,
 * which is the point — this has to be the same everywhere, Office or no Office.
 */
const THEME =
  `${XML}<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements>` +
  `<a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `${color("dk2", "44546A")}${color("lt2", "E7E6E6")}` +
  `${color("accent1", "4472C4")}${color("accent2", "ED7D31")}${color("accent3", "A5A5A5")}` +
  `${color("accent4", "FFC000")}${color("accent5", "5B9BD5")}${color("accent6", "70AD47")}` +
  `${color("hlink", "0563C1")}${color("folHlink", "954F72")}</a:clrScheme>` +
  `<a:fontScheme name="Office">` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Office">` +
  `<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements></a:theme>`;

/**
 * A template main part, not a presentation's: no slides at all. The builder turns it
 * into a presentation, and a template that shipped sample slides would have to have
 * them stripped — which is the one thing every template's author is surprised by.
 */
const PRESENTATION =
  `${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1">` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst/>` +
  `<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>` +
  `<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle>` +
  `</p:presentation>`;

const override = (part: string, type: string): string =>
  `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;

const CONTENT_TYPES =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  override("ppt/presentation.xml", "presentationml.template.main+xml") +
  override("ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster+xml") +
  LAYOUTS.map((_, i) => override(`ppt/slideLayouts/slideLayout${i + 1}.xml`, "presentationml.slideLayout+xml")).join("") +
  override("ppt/theme/theme1.xml", "theme+xml") +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

/** Built once: the bytes never change, and every caller only reads them. */
let cached: Buffer | undefined;

/**
 * The built-in template, as .potx bytes. Deterministic — `writeZip` stamps every entry
 * with the same timestamp — so the same build always produces the same package.
 */
export function defaultTemplateBytes(): Buffer {
  if (cached !== undefined) return cached;

  const entries: ZipInput[] = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `${XML}<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId1" Type="${T("officeDocument")}" Target="ppt/presentation.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
          `</Relationships>`,
        "utf8",
      ),
    },
    {
      name: "docProps/core.xml",
      data: Buffer.from(
        `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"` +
          ` xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Office Theme</dc:title></cp:coreProperties>`,
        "utf8",
      ),
    },
    { name: "ppt/presentation.xml", data: Buffer.from(PRESENTATION, "utf8") },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: Buffer.from(
        rels([
          ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
          ["rId2", "theme", "theme/theme1.xml"],
        ]),
        "utf8",
      ),
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: Buffer.from(MASTER, "utf8") },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: Buffer.from(
        rels([
          ...LAYOUTS.map(
            (_, i) => [`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`] as [string, string, string],
          ),
          [`rId${LAYOUTS.length + 1}`, "theme", "../theme/theme1.xml"],
        ]),
        "utf8",
      ),
    },
    { name: "ppt/theme/theme1.xml", data: Buffer.from(THEME, "utf8") },
  ];

  LAYOUTS.forEach(([name, type, shapes], i) => {
    entries.push({ name: `ppt/slideLayouts/slideLayout${i + 1}.xml`, data: Buffer.from(layoutPart(name, type, shapes), "utf8") });
    entries.push({
      name: `ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`,
      data: Buffer.from(rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]), "utf8"),
    });
  });

  cached = writeZip(entries);
  return cached;
}
