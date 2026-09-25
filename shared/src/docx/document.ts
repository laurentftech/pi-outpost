/**
 * A Word document around a body of blocks, as the export writes it.
 *
 * Shared by the browser's export and the server's Word tools, so a document the
 * agent writes and one a reader downloads carry the same heading levels and the
 * same list numbering.
 */
import { AlignmentType, Document, LevelFormat } from "docx";
import { ORDERED_NUMBERING, type DocxBlock } from "./markdownToDocx.ts";

export function docxDocument(children: DocxBlock[]): Document {
  return new Document({
    styles: { default: headingOutlineLevels() },
    numbering: { config: [orderedNumbering()] },
    sections: [{ children }],
  });
}

/**
 * Heading 1–6 declared as outline levels 0–5.
 *
 * The writer's default heading styles carry a colour and a size and nothing else, so a
 * heading looked like one without being one: Word's navigation pane, its table of
 * contents and chapter numbering all read the paragraph's outline level, and a style
 * that does not declare one leaves the paragraph at body-text level. The level goes on
 * the style rather than on each paragraph, where Word itself keeps it; the writer merges
 * it with the style's own run properties.
 */
function headingOutlineLevels() {
  const level = (outlineLevel: number) => ({ paragraph: { outlineLevel } });
  return {
    heading1: level(0),
    heading2: level(1),
    heading3: level(2),
    heading4: level(3),
    heading5: level(4),
    heading6: level(5),
  };
}

/**
 * The definition ordered lists draw their markers from.
 *
 * Word does not number a paragraph because it looks like a list item; it numbers
 * one that points at a numbering definition. Five levels, cycling through the
 * markers Word's own default list uses, each indented one step further than the
 * last so nesting reads as nesting.
 */
function orderedNumbering() {
  const FORMATS = [
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
    LevelFormat.LOWER_ROMAN,
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
  ] as const;
  return {
    reference: ORDERED_NUMBERING,
    levels: FORMATS.map((format, level) => ({
      level,
      format,
      text: `%${level + 1}.`,
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  };
}

