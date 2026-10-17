// Prints document.html to PDF, then writes the page images and the page texts the demo shows.
// Needs Playwright's Chromium (pnpm exec playwright install chromium, or PLAYWRIGHT=<path to another install's index.mjs>), pdftoppm and ImageMagick.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "public");
rmSync(join(out, "pages"), { recursive: true, force: true });
mkdirSync(join(out, "pages"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(join(here, "document.html")).href);
await page.pdf({ path: join(out, "document.pdf"), format: "A4", preferCSSPageSize: true });
await browser.close();
execFileSync("pdftoppm", ["-r", "90", "-png", join(out, "document.pdf"), join(out, "pages", "p")]);
for (const f of readdirSync(join(out, "pages"))) {
  const n = f.replace(/^p-0*/, "").replace(/\.png$/, "");
  execFileSync("magick", [join(out, "pages", f), "-quality", "80", join(out, "pages", `${n}.webp`)]);
  rmSync(join(out, "pages", f));
}
execFileSync("node", [join(here, "..", "bin", "page-text.mjs"), join(out, "document.pdf"), join(out, "pages")], { stdio: "inherit" });
