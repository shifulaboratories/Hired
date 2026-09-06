import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";

/**
 * Server-side PDF rendering.
 *
 * The print page at /print/[id] stays exactly as it was — it is why the output
 * is real selectable text rather than an image, and it is the fallback whenever
 * this module reports itself unavailable. All this does is drive a headless
 * browser to that same page and capture the bytes, so there is one renderer,
 * not two, and a PDF can never drift from what the editor shows.
 *
 * `playwright-core` is deliberate: unlike `playwright` it downloads no browser
 * on install, so adding it cannot slow or break a deploy. It uses whatever
 * Chromium the host already has. If there is none, `pdfRenderer()` returns
 * `{ available: false }` and every caller falls back to the print dialog — the
 * app is never worse off than before this file existed.
 */

/**
 * Where a Chromium might live. PDF_CHROMIUM_PATH is checked first so a host
 * with an unusual layout can point at one; it is not required anywhere, and
 * self-hosting still needs only DATABASE_URL.
 */
const CANDIDATE_PATHS = [
  process.env.PDF_CHROMIUM_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
  "/root/.cache/ms-playwright/chromium/chrome-linux/chrome",
];

/** Resolved once per process; finding it is a handful of stat calls. */
let cachedPath: string | null | undefined;

export function chromiumPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  for (const candidate of CANDIDATE_PATHS) {
    if (candidate && existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  // Playwright's own install lays browsers out under a versioned directory.
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/root/.cache/ms-playwright"].filter(
    Boolean,
  ) as string[];
  for (const root of roots) {
    for (const suffix of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      // A glob would need a directory read; a few explicit probes are cheaper
      // and this only ever runs once.
      for (const version of ["", "-1194", "-1180", "-1160", "-1148"]) {
        const candidate = `${root}/chromium${version}/${suffix}`;
        if (existsSync(candidate)) {
          cachedPath = candidate;
          return cachedPath;
        }
      }
    }
  }

  cachedPath = null;
  return cachedPath;
}

export function pdfRenderingAvailable() {
  return chromiumPath() !== null;
}

export type PdfResult = {
  bytes: Buffer;
  /** Page count, read back off the produced file rather than estimated. */
  pages: number;
};

/**
 * Render a URL of this app to PDF, authenticated as the given session token.
 *
 * The token is a short-lived row in the ordinary Session table rather than a
 * new kind of credential: the print page keeps its `requireUser()` guard, and
 * nothing new is exempt from authentication.
 */
export async function renderPdf(input: {
  url: string;
  sessionCookie: { name: string; value: string; domain: string; secure: boolean };
}): Promise<PdfResult> {
  const executablePath = chromiumPath();
  if (!executablePath) {
    throw new Error(
      "No Chromium on this host, so the server cannot render a PDF. Use the print page instead.",
    );
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      // --no-sandbox is required in containers, which is where this runs.
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: input.sessionCookie.name,
        value: input.sessionCookie.value,
        domain: input.sessionCookie.domain,
        path: "/",
        httpOnly: true,
        secure: input.sessionCookie.secure,
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();
    const response = await page.goto(input.url, { waitUntil: "networkidle", timeout: 30_000 });
    if (!response || !response.ok()) {
      throw new Error(`The print page answered ${response?.status() ?? "nothing"}.`);
    }

    // The page must have actually rendered a document, not a redirect to login.
    const paper = await page.locator(".resume-paper").count();
    if (paper === 0) throw new Error("The print page rendered no document.");

    const bytes = await page.pdf({
      format: "Letter",
      printBackground: true,
      // No margin stated here: the document's own @page rule carries it, and
      // preferCSSPageSize is what makes Chromium honour that rather than its
      // own default. Setting one here as well is a second place for the margin
      // to be decided, which is how the PDF and the print page drift apart.
      preferCSSPageSize: true,
    });

    return { bytes, pages: countPages(bytes) };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Count `/Type /Page` objects. Crude, but read off the real file. */
function countPages(bytes: Buffer) {
  const matches = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return Math.max(1, matches?.length ?? 1);
}
