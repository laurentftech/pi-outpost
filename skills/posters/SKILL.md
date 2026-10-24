---
name: posters
description: Make a poster, a worksheet, a slide or any one-page visual (a class poster, a vocabulary sheet, a timetable, an announcement) as a .poster.html file the user opens in the file viewer, retouches there — corrects a text, moves a pictogram, changes a colour — and exports to Word to print or PowerPoint to show. Use whenever the user asks for a poster, an affiche, a printable sheet, a visual, or a slide made to look designed, or to change an existing .poster.html file.
license: MIT
metadata:
  version: "1.0"
---

# Posters

A poster is one page of HTML and CSS in a `.poster.html` file. You write it with your
ordinary file tools; the user opens it in the file viewer, where it is drawn in the poster
editor: they double-click a text to correct it, drag a pictogram, change colours, save, and
export it to Word (an A4 page to print) or PowerPoint (a slide to show). You cannot see it
rendered.

## The loop

1. Choose the format: A4 or A3 to print, portrait or landscape; `slide-16:9` to project.
2. Write the file with the skeleton below, under a short path such as
   `posters/class-rules.poster.html`. Keep the three markers exactly: the
   `poster-format` meta, the `<style data-poster>` stylesheet, and the
   `<div class="poster-page">` holding the markup.
3. Tell the user where it is, as a link they can click to open it:
   `[Our class rules](./posters/class-rules.poster.html)`.
4. To change a poster, **read the file first**: the user may have retouched it in the editor,
   and your change must keep their edits — their texts, colours and positions — unless they
   asked otherwise. Write the whole file back.

How to write a poster:
- The markup is the content of one page of the chosen format, in CSS pixels: A4-portrait 794 x 1123; A4-landscape 1123 x 794; A3-portrait 1123 x 1587; A3-landscape 1587 x 1123; slide-16:9 1280 x 720. Pick slide-16:9 for a poster meant to be projected or shown in PowerPoint, A4 or A3 to print. Lay it out to fill exactly that page: the outer element is width:100%; height:100%.
- The stylesheet is separate from the markup: style through classes, not long inline style attributes. CSS variables, grid and flexbox are fine.
- Keep every text as real text in ordinary elements (h1, h2, p, li, span, div) so the person can click and correct it. Never put text inside SVG, an image or a canvas.
- Pictograms: emoji (🌱 📚 ✏️ 🎨) in their own element, sized with font-size, or small inline SVG shapes without text. No external images, fonts or links: nothing is fetched. No picture embedded as data.
- Fonts: system fonts only, e.g. "Arial Rounded MT Bold", "Trebuchet MS", Verdana, Arial, sans-serif.
- No script, and no event attributes (onclick…): they are removed.
- The person exports the poster to Word (to print) or PowerPoint (to show) from the editor, as a picture of the page: texts are corrected in the editor, not in Word.

## The skeleton

Replace the format, the title, the stylesheet and the markup; keep everything else as it is.
The page rules in the first `<style>` are the ones every poster has: the paper size, no
margin, colours kept when printed.

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="poster-format" content="A4-portrait">
<title>Our class rules</title>
<style>
@page { size: 210mm 297mm; margin: 0; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.poster-page { width: 794px; height: 1123px; overflow: hidden; position: relative; }
</style>
<style data-poster>
STYLESHEET
</style>
</head>
<body><div class="poster-page">MARKUP</div></body>
</html>
```

For another format, change the meta, the `@page` size and the `.poster-page` size together:
A4 landscape `297mm 210mm`, 1123 x 794; A3 portrait `297mm 420mm`, 1123 x 1587; A3 landscape
`420mm 297mm`, 1587 x 1123; `slide-16:9` `338.667mm 190.5mm`, 1280 x 720.

## A complete poster

Start from this one: its stylesheet (`STYLESHEET` above) and its markup (`MARKUP`).

```css
.poster { width: 100%; height: 100%; padding: 40px; background: #fff8ec; font-family: "Trebuchet MS", Verdana, sans-serif; display: flex; flex-direction: column; gap: 28px; }
.banner { background: #3f51b5; color: #fff; border-radius: 28px; padding: 26px 30px; display: flex; align-items: center; gap: 22px; }
.banner h1 { margin: 0; flex: 1; text-align: center; font-size: 56px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
.star { font-size: 64px; }
.rules { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.rule { --c: #ff8a65; background: #fff; border: 4px solid var(--c); border-radius: 22px; padding: 20px; display: flex; gap: 18px; align-items: center; }
.rule.c2 { --c: #4fc3f7; } .rule.c3 { --c: #81c784; } .rule.c4 { --c: #ffd54f; }
.icon { width: 110px; height: 110px; flex: none; border-radius: 50%; background: var(--c); display: flex; align-items: center; justify-content: center; font-size: 62px; }
.rule h2 { margin: 0 0 6px; font-size: 32px; color: #263238; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
.rule p { margin: 0; font-size: 21px; color: #546e7a; }
.motto { margin: 0; align-self: center; background: #ffe082; color: #5d4037; border-radius: 40px; padding: 14px 40px; font-size: 28px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
```

```html
<div class="poster">
  <header class="banner"><span class="star">⭐</span><h1>Our class rules</h1><span class="star">⭐</span></header>
  <main class="rules">
    <div class="rule c1"><div class="icon">🙋</div><div><h2>I raise my hand</h2><p>to speak</p></div></div>
    <div class="rule c2"><div class="icon">👂</div><div><h2>I listen</h2><p>to whoever is speaking</p></div></div>
    <div class="rule c3"><div class="icon">🤝</div><div><h2>I respect</h2><p>my classmates and our things</p></div></div>
    <div class="rule c4"><div class="icon">🧹</div><div><h2>I tidy up</h2><p>my desk before I leave</p></div></div>
  </main>
  <p class="motto">Together, we learn better!</p>
</div>
```
