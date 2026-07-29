/**
 * Build the site's share card and its PNG icons.
 *
 *   npm run og
 *
 * Two rasterisers, for one honest reason. The icons are pure geometry and go
 * through resvg, the same way build/icon.svg does. The share card has the
 * wordmark on it, and the wordmark is *text* — @fontsource ships woff and
 * woff2 only, resvg's font database reads neither, and a card that silently
 * falls back to a system face is worse than no card. So the card is rendered
 * by Electron, which already has the font stack the site itself uses.
 *
 * The fonts are inlined as data URIs rather than referenced by file:// URL:
 * this runs on Windows, and a Windows path inside a CSS url() is a quoting
 * problem waiting to happen.
 *
 * Output lands in site/public/, which Astro copies verbatim.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'site', 'public')

/** Brand values. Canonical source is brand/BRAND.md; nothing is invented here. */
const OBSIDIAN = '#0F1115'
const PAPER = '#F5F3EE'
const EMBER = '#FF5A2B'
const INK = '#E8E6E1'
const INK_MUTED = '#9AA0AA'
const LINE = '#2A2F39'

/** The one size every platform agrees on for a large share card. */
const CARD = { width: 1200, height: 630 }

async function fontDataUri(pkg, file) {
  const bytes = await readFile(join(root, 'node_modules', '@fontsource', pkg, 'files', file))
  return `data:font/woff2;base64,${bytes.toString('base64')}`
}

async function buildCardHtml() {
  const grotesk = await fontDataUri('space-grotesk', 'space-grotesk-latin-500-normal.woff2')
  const plex = await fontDataUri('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2')

  // The mark's geometry is canonical — brand/BRAND.md §1, identical to
  // brand/assets/claven-mark.svg. Explicit hex fills, never currentColor.
  const mark = `<svg width="132" height="132" viewBox="0 0 96 96" fill="none">
      <path d="M8 8 H62 L34 88 H8 Z" fill="${PAPER}"></path>
      <path d="M72 8 H88 V88 H44 Z" fill="${EMBER}"></path>
    </svg>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Space Grotesk'; src: url('${grotesk}') format('woff2'); font-weight: 500; }
  @font-face { font-family: 'IBM Plex Sans'; src: url('${plex}') format('woff2'); font-weight: 400; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${CARD.width}px; height: ${CARD.height}px; }
  body {
    background: ${OBSIDIAN};
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px;
    /* Flat geometry, no gradients, no glows — the brand forbids all three. */
  }
  .lockup { display: flex; align-items: center; gap: 34px; }
  /* Space Grotesk 500, uppercase, +0.30em, with left padding equal to the
     tracking. CSS puts the tracking after the final N, so without the padding
     the block sits visibly off-centre against the mark. */
  .wordmark {
    font-family: 'Space Grotesk'; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.30em; padding-left: 0.30em;
    font-size: 74px; color: ${INK}; line-height: 1;
  }
  .rule { width: 100%; height: 1px; background: ${LINE}; margin: 52px 0; }
  .tagline {
    font-family: 'IBM Plex Sans'; font-weight: 400;
    font-size: 34px; color: ${INK_MUTED}; line-height: 1.4;
  }
  .meta {
    font-family: 'IBM Plex Sans'; font-weight: 400;
    font-size: 21px; color: #6B7280; margin-top: 22px;
  }
  /* The single spend of ember beyond the mark: a 4px rail down the left edge,
     matching the active-file indicator in the editor itself. */
  .rail { position: fixed; left: 0; top: 0; bottom: 0; width: 4px; background: ${EMBER}; }
</style></head>
<body>
  <div class="rail"></div>
  <div class="lockup">${mark}<span class="wordmark">Claven</span></div>
  <div class="rule"></div>
  <p class="tagline">A code editor, built in public.</p>
  <p class="meta">open source · apache-2.0 · claven.dev</p>
</body></html>`
}

app.whenReady().then(async () => {
  // ---- the share card ---------------------------------------------------
  const win = new BrowserWindow({
    width: CARD.width,
    height: CARD.height,
    // Without this, width and height describe the *window*, and the frame eats
    // 16x65px of it — the first run produced a 1184x565 card that every
    // platform would then letterbox or crop.
    useContentSize: true,
    show: false,
    backgroundColor: OBSIDIAN,
    webPreferences: { offscreen: false }
  })

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(await buildCardHtml())}`)
  // The fonts are inline, so there is nothing to fetch — this is only waiting
  // for layout and the font face to be applied.
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const card = await win.webContents.capturePage()
  await writeFile(join(publicDir, 'og.png'), card.toPNG())
  const { width, height } = card.getSize()
  console.log(`og.png                ${width}x${height}`)

  // ---- icons ------------------------------------------------------------
  const mark = await readFile(join(root, 'brand', 'assets', 'claven-mark.svg'), 'utf8')
  const tile = await readFile(join(root, 'build', 'icon.svg'), 'utf8')

  const render = (svg, size) =>
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

  // A fallback for browsers that will not take an SVG favicon. Deliberately
  // not 16px: below 20px the brand calls for the mono mark, and a PNG cannot
  // adapt to the tab colour the way the SVG does. Small sizes stay with
  // favicon.svg, which every browser that renders at 16px supports anyway.
  await writeFile(join(publicDir, 'favicon-32.png'), render(mark, 32))
  console.log('favicon-32.png        32x32')

  // iOS home screen. The rounded tile, not the bare mark: iOS composites onto
  // an opaque tile regardless, so shipping the mark alone gets it a white box.
  await writeFile(join(publicDir, 'apple-touch-icon.png'), render(tile, 180))
  console.log('apple-touch-icon.png  180x180')

  app.exit(0)
})
