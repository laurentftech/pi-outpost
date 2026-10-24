// Probe: can a script in a sandboxed frame reach the document of a frame it creates?
// GrapesJS draws its canvas in such a frame. Run: node scripts/probes/nested-frame-sandbox.mjs
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (message) => console.log(message.text()));
for (const sandbox of ["allow-scripts", "allow-scripts allow-same-origin"]) {
  await page.setContent(`<iframe sandbox="${sandbox}" srcdoc="<body><script>
    const blank = document.createElement('iframe'); document.body.append(blank);
    let a; try { a = String(!!blank.contentDocument); } catch (e) { a = 'throws ' + e.message; }
    const doc = document.createElement('iframe'); doc.srcdoc = '<p>x</p>'; document.body.append(doc);
    setTimeout(() => { let b; try { b = String(!!doc.contentDocument); } catch (e) { b = 'throws'; } console.log('${sandbox}: about:blank ' + a + ', srcdoc ' + b); }, 300);
  </script></body>"></iframe>`);
  await page.waitForTimeout(700);
}
await browser.close();
