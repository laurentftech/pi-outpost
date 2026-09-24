/**
 * Builds the PowerPoint template the presentation builder tests start from.
 *
 * Written by hand, like the other Office fixtures, because the tests assert things
 * about the markup that only a package under our control can promise: a layout
 * placeholder that states no position and must inherit its master's, a sample slide
 * whose notes and picture only it reaches, a custom show and a section list naming
 * that slide, and a template (.potx) main part the output must turn into a
 * presentation. The zip is written here too, so this needs nothing installed.
 *
 *   node server/test/fixtures/make-pptx-template.mjs
 */
import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const T = (name) => `${R}/${name}`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

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
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);
    files.push({ name: nameBytes, crc: crc32(raw), compressed: body.length, raw: raw.length, offset });
    offset += local.length + nameBytes.length + body.length;
  }
  const directoryOffset = offset;
  for (const file of files) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(file.crc, 16);
    central.writeUInt32LE(file.compressed, 20);
    central.writeUInt32LE(file.raw, 24);
    central.writeUInt16LE(file.name.length, 28);
    central.writeUInt32LE(file.offset, 42);
    chunks.push(central, file.name);
    offset += central.length + file.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(offset - directoryOffset, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

/** A 2×2 red PNG — the sample slide's picture, which only that slide reaches. */
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const rels = (list) =>
  `${XML}<Relationships xmlns="${REL}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${T(type)}" Target="${target}"/>`).join("")}</Relationships>`;

const xfrm = (x, y, cx, cy) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

/** A placeholder shape; `box` omitted means the shape inherits its position. */
const ph = (id, name, attrs, box, text = "Click to edit") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr><p:ph${attrs}/></p:nvPr></p:nvSpPr><p:spPr>${box ?? ""}</p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

const tree = (shapes) =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr>${xfrm(0, 0, 0, 0).replace("</a:xfrm>", '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>')}</p:grpSpPr>${shapes}</p:spTree>`;

const layout = (name, type, shapes) =>
  `${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="${type}" preserve="1">` +
  `<p:cSld name="${name}">${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const LAYOUTS = [
  ["Title Slide", "title", ph(2, "Title", ' type="ctrTitle"', xfrm(1524000, 1122363, 9144000, 2387600)) + ph(3, "Subtitle", ' type="subTitle" idx="1"', xfrm(1524000, 3602038, 9144000, 1655762))],
  // No positions of its own: both come from the master.
  ["Title and Content", "obj", ph(2, "Title", ' type="title"') + ph(3, "Content", ' idx="1"')],
  ["Two Content", "twoObj", ph(2, "Title", ' type="title"') + ph(3, "Left", ' sz="half" idx="1"', xfrm(838200, 1825625, 5181600, 4351338)) + ph(4, "Right", ' sz="half" idx="2"', xfrm(6172200, 1825625, 5181600, 4351338))],
  ["Picture with Caption", "picTx", ph(2, "Title", ' type="title"', xfrm(839788, 457200, 3932237, 1600200)) + ph(3, "Picture", ' type="pic" idx="1"', xfrm(5183188, 987425, 6172200, 4873625)) + ph(4, "Caption", ' type="body" sz="half" idx="2"', xfrm(839788, 2057400, 3932237, 3811588))],
  ["Section Header", "secHead", ph(2, "Title", ' type="title"', xfrm(831850, 1709738, 10515600, 2852737)) + ph(3, "Text", ' type="body" idx="1"', xfrm(831850, 4589463, 10515600, 1500187))],
  ["Title Only", "titleOnly", ph(2, "Title", ' type="title"')],
  ["Blank", "blank", ""],
];

const MASTER =
  `${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>` +
  tree(ph(2, "Title Placeholder", ' type="title"', xfrm(838200, 365125, 10515600, 1325563)) + ph(3, "Text Placeholder", ' type="body" idx="1"', xfrm(838200, 1825625, 10515600, 4351338))) +
  `</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst>${LAYOUTS.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr marL="685800" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`;

const color = (name, value) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
const THEME =
  `${XML}<a:theme xmlns:a="${A}" name="Fixture"><a:themeElements>` +
  `<a:clrScheme name="Fixture">${color("dk1", "000000")}${color("lt1", "FFFFFF")}${color("dk2", "1F2937")}${color("lt2", "F3F4F6")}` +
  `${color("accent1", "2563EB")}${color("accent2", "16A34A")}${color("accent3", "DC2626")}${color("accent4", "CA8A04")}${color("accent5", "7C3AED")}${color("accent6", "0891B2")}` +
  `${color("hlink", "2563EB")}${color("folHlink", "7C3AED")}</a:clrScheme>` +
  `<a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Fixture"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements></a:theme>`;

const SAMPLE_SLIDE =
  `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>` +
  tree(ph(2, "Title", ' type="title"', undefined, "Sample slide the template ships with") + `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr>${xfrm(0, 0, 100, 100)}</p:spPr></p:pic>`) +
  `</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const NOTES = `${XML}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>${tree(ph(2, "Notes", ' type="body" idx="1"', undefined, "Speaker notes of the sample"))}</p:cSld></p:notes>`;

const PRESENTATION =
  `${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1">` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
  `<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>` +
  `<p:custShowLst><p:custShow name="Short" id="0"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>` +
  `<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle>` +
  `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5A84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Intro" id="{00000000-0000-0000-0000-000000000001}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext>` +
  `<p:ext uri="{EFAFB233-063F-42B5-8137-9DF3F51BA10A}"><p15:sldGuideLst xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"/></p:ext></p:extLst>` +
  `</p:presentation>`;

const override = (part, type) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;
const CONTENT_TYPES =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
  override("ppt/presentation.xml", "presentationml.template.main+xml") +
  override("ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster+xml") +
  LAYOUTS.map((_, i) => override(`ppt/slideLayouts/slideLayout${i + 1}.xml`, "presentationml.slideLayout+xml")).join("") +
  override("ppt/slides/slide1.xml", "presentationml.slide+xml") +
  override("ppt/notesSlides/notesSlide1.xml", "presentationml.notesSlide+xml") +
  override("ppt/theme/theme1.xml", "theme+xml") +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

const entries = {
  "[Content_Types].xml": CONTENT_TYPES,
  "_rels/.rels":
    `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${T("officeDocument")}" Target="ppt/presentation.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  "docProps/core.xml": `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture template</dc:title></cp:coreProperties>`,
  "ppt/presentation.xml": PRESENTATION,
  "ppt/_rels/presentation.xml.rels": rels([
    ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
    ["rId2", "slide", "slides/slide1.xml"],
    ["rId3", "theme", "theme/theme1.xml"],
  ]),
  "ppt/slideMasters/slideMaster1.xml": MASTER,
  "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
    ...LAYOUTS.map((_, i) => [`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`]),
    [`rId${LAYOUTS.length + 1}`, "theme", "../theme/theme1.xml"],
  ]),
  "ppt/theme/theme1.xml": THEME,
  "ppt/slides/slide1.xml": SAMPLE_SLIDE,
  "ppt/slides/_rels/slide1.xml.rels": rels([
    ["rId1", "slideLayout", "../slideLayouts/slideLayout2.xml"],
    ["rId2", "image", "../media/sample-logo.png"],
    ["rId3", "notesSlide", "../notesSlides/notesSlide1.xml"],
  ]),
  "ppt/notesSlides/notesSlide1.xml": NOTES,
  "ppt/notesSlides/_rels/notesSlide1.xml.rels": rels([["rId1", "slide", "../slides/slide1.xml"]]),
  "ppt/media/sample-logo.png": png(),
};
LAYOUTS.forEach(([name, type, shapes], i) => {
  entries[`ppt/slideLayouts/slideLayout${i + 1}.xml`] = layout(name, type, shapes);
  entries[`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`] = rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]);
});

await writeFile(path.join(HERE, "pptx-template.potx"), zip(entries));
console.log("wrote pptx-template.potx");
