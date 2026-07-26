/**
 * Writes the text fixtures byte-exactly.
 *
 * These cannot be checked in as ordinary text files: any editor, formatter or
 * git normalization would quietly "fix" the line endings and BOMs, and then the
 * tests would pass for the wrong reason. .gitattributes marks tests/fixtures/**
 * as binary so git leaves them alone, and this script regenerates them.
 *
 *   node tests/generate-fixtures.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures')

const BOM8 = Buffer.from([0xef, 0xbb, 0xbf])
const BOM16LE = Buffer.from([0xff, 0xfe])
const BOM16BE = Buffer.from([0xfe, 0xff])

const utf16be = (text) => {
  const buffer = Buffer.from(text, 'utf16le')
  buffer.swap16()
  return buffer
}

const fixtures = {
  'lf.txt': Buffer.from('alpha\nbeta\ngamma\n', 'utf8'),
  'crlf.txt': Buffer.from('alpha\r\nbeta\r\ngamma\r\n', 'utf8'),
  'cr.txt': Buffer.from('alpha\rbeta\rgamma\r', 'utf8'),
  // CRLF dominant (2) over LF (1), so a save must write CRLF.
  'mixed.txt': Buffer.from('alpha\r\nbeta\ngamma\r\n', 'utf8'),
  'no-trailing-newline.txt': Buffer.from('alpha\nbeta', 'utf8'),
  'empty.txt': Buffer.alloc(0),
  'utf8-bom.txt': Buffer.concat([BOM8, Buffer.from('alpha\nbeta\n', 'utf8')]),
  'utf16le-bom.txt': Buffer.concat([BOM16LE, Buffer.from('alpha\nbeta\n', 'utf16le')]),
  'utf16be-bom.txt': Buffer.concat([BOM16BE, utf16be('alpha\nbeta\n')]),
  // Arabic, because RTL and non-ASCII must survive a round trip untouched.
  'arabic.txt': Buffer.from('مرحبا بالعالم\nconst سلام = 1\n', 'utf8'),
  // Emoji with a skin-tone modifier: one grapheme, several code points.
  'grapheme.txt': Buffer.from('wave \u{1F44B}\u{1F3FD} done\n', 'utf8'),
  // NUL in the first bytes: must be refused as binary.
  'binary.bin': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0x00, 0xff])
}

await mkdir(dir, { recursive: true })
for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(join(dir, name), bytes)
  console.log(`${name.padEnd(26)} ${bytes.length} bytes`)
}
