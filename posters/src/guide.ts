/**
 * The guide every host gives the model for writing a poster — the Claude extension's
 * tool descriptions, the Open WebUI tool server's, and pi-outpost's `posters` skill all
 * embed these strings as they are, so the three agree (poster-documents: ThePosterGuide).
 *
 * The rules carry what the editor needs, beyond what a good-looking page needs: every
 * text as real text in an ordinary element, so the person can click and correct it; no
 * picture embedded as data, so the poster stays small; nothing fetched, since no host
 * lets the page reach the network.
 *
 * Isomorphic.
 */
import { FORMAT_NAMES, FORMATS } from "./format.ts";

const sizes = FORMAT_NAMES.map((name) => `${name} ${FORMATS[name].width} x ${FORMATS[name].height}`).join("; ");

/** The rules, as a bulleted list: what a description or a skill says before anything host-specific. */
export const POSTER_GUIDE = `How to write a poster:
- The markup is the content of one page of the chosen format, in CSS pixels: ${sizes}. Pick slide-16:9 for a poster meant to be projected or shown in PowerPoint, A4 or A3 to print. Lay it out to fill exactly that page: the outer element is width:100%; height:100%.
- The stylesheet is separate from the markup: style through classes, not long inline style attributes. CSS variables, grid and flexbox are fine.
- Keep every text as real text in ordinary elements (h1, h2, p, li, span, div) so the person can click and correct it. Never put text inside SVG, an image or a canvas.
- Pictograms: emoji (🌱 📚 ✏️ 🎨) in their own element, sized with font-size, or small inline SVG shapes without text. No external images, fonts or links: nothing is fetched. No picture embedded as data.
- Fonts: system fonts only, e.g. "Arial Rounded MT Bold", "Trebuchet MS", Verdana, Arial, sans-serif.
- No script, and no event attributes (onclick…): they are removed.
- The person exports the poster to Word (to print) or PowerPoint (to show) from the editor, as a picture of the page: texts are corrected in the editor, not in Word.`;

/** One complete poster, markup and stylesheet, to start from: weak models follow an example more surely than rules. */
export const POSTER_EXAMPLE = {
  format: "A4-portrait",
  html: `<div class="poster">
  <header class="banner"><span class="star">⭐</span><h1>Our class rules</h1><span class="star">⭐</span></header>
  <main class="rules">
    <div class="rule c1"><div class="icon">🙋</div><div><h2>I raise my hand</h2><p>to speak</p></div></div>
    <div class="rule c2"><div class="icon">👂</div><div><h2>I listen</h2><p>to whoever is speaking</p></div></div>
    <div class="rule c3"><div class="icon">🤝</div><div><h2>I respect</h2><p>my classmates and our things</p></div></div>
    <div class="rule c4"><div class="icon">🧹</div><div><h2>I tidy up</h2><p>my desk before I leave</p></div></div>
  </main>
  <p class="motto">Together, we learn better!</p>
</div>`,
  css: `.poster { width: 100%; height: 100%; padding: 40px; background: #fff8ec; font-family: "Trebuchet MS", Verdana, sans-serif; display: flex; flex-direction: column; gap: 28px; }
.banner { background: #3f51b5; color: #fff; border-radius: 28px; padding: 26px 30px; display: flex; align-items: center; gap: 22px; }
.banner h1 { margin: 0; flex: 1; text-align: center; font-size: 56px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
.star { font-size: 64px; }
.rules { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.rule { --c: #ff8a65; background: #fff; border: 4px solid var(--c); border-radius: 22px; padding: 20px; display: flex; gap: 18px; align-items: center; }
.rule.c2 { --c: #4fc3f7; } .rule.c3 { --c: #81c784; } .rule.c4 { --c: #ffd54f; }
.icon { width: 110px; height: 110px; flex: none; border-radius: 50%; background: var(--c); display: flex; align-items: center; justify-content: center; font-size: 62px; }
.rule h2 { margin: 0 0 6px; font-size: 32px; color: #263238; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
.rule p { margin: 0; font-size: 21px; color: #546e7a; }
.motto { margin: 0; align-self: center; background: #ffe082; color: #5d4037; border-radius: 40px; padding: 14px 40px; font-size: 28px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }`,
} as const;
