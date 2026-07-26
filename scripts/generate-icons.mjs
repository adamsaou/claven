/**
 * Rasterise build/icon.svg into every icon the app actually needs.
 *
 *   npm run icons
 *
 * Uses resvg deliberately: it is the same rasteriser electron-builder uses, so
 * what you see in `npm run dev` is what ships. (It is also why build/icon.svg
 * must carry explicit hex fills — resvg has no currentColor substitution and
 * silently renders it black.)
 *
 * The ICO is hand-authored rather than left to electron-builder, which
 * generates only [16, 24, 32, 48, 64, 128, 256] and omits 20, 30, 36, 40 and 96
 * -- exactly the sizes Windows uses for the tray and taskbar at 125% and 150%
 * DPI, which is most Windows laptops. electron-builder passes a pre-built
 * build/icon.ico through untouched, so authoring it here wins.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'build', 'icon.svg'), 'utf8')

/** Every frame Windows asks for, including the four electron-builder skips. */
const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 64, 96, 128, 256]

/** freedesktop hicolor sizes, per electron-builder's LINUX_SIZES. */
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

function render(size) {
  // Rasterise from the vector at each target size rather than downscaling one
  // large bitmap -- a 1024px master box-filtered down to 16px loses the cut.
  const resvg = new Resvg(source, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
}

const buildDir = join(root, 'build')
const iconsDir = join(buildDir, 'icons')
await mkdir(iconsDir, { recursive: true })

// Linux: build/icons/<size>.png, the layout electron-builder expects.
for (const size of LINUX_SIZES) {
  await writeFile(join(iconsDir, `${size}.png`), render(size))
}

// The window icon used at runtime by BrowserWindow on Linux, and the source
// electron-builder falls back to.
await writeFile(join(buildDir, 'icon.png'), render(512))

// Windows: one multi-frame ICO. png-to-ico caps at 256, which is also the
// largest frame the ICO format stores uncompressed-addressable.
const frames = ICO_SIZES.map((size) => render(size))
await writeFile(join(buildDir, 'icon.ico'), await pngToIco(frames))

console.log(`icon.ico    ${ICO_SIZES.length} frames: ${ICO_SIZES.join(', ')}`)
console.log(`icons/      ${LINUX_SIZES.length} pngs: ${LINUX_SIZES.join(', ')}`)
console.log('icon.png    512')
