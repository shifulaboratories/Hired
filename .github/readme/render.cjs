// Renders the README's drawn art from art.html into PNGs beside it, light and
// dark, at 2x. Run from the repo root: node .github/readme/render.cjs
// Needs Playwright with a Chromium; Inter and JetBrains Mono should be installed
// locally, or the text falls back to the system sans.
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const here = __dirname;
const src = pathToFileURL(path.join(here, "art.html")).href;
const figures = ["banner", "how", "talk", "flip"];

(async () => {
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${src}?theme=${theme}`);
  await page.evaluate(() => document.fonts.ready);
  for (const id of figures) {
    const out = path.join(here, `${id}-${theme}.png`);
    await page.locator(`#${id}`).screenshot({ path: out, omitBackground: true });
    console.log(path.relative(process.cwd(), out));
  }
  await page.close();
}
await browser.close();
})();
