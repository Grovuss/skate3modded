// The game's text tables (LANGUAGE_<language>_Global_*.BIN, little-endian):
//
//   0x00 u32 0x00039000      0x04 u32 file size - 8     0x08 u32 row count
//   0x0c u32 0x1c            0x10 u32 offset of the strings, minus 8
//   0x14 table name ("Global")
//   0x24 rows { u32 id, u32 offset into the strings }, sorted by id
//   then the NUL-terminated strings, in their own order
//
// A row's id is a hash of its label ("ID_PATH_NAME_THRASHER"): h = h * 33 + c, starting from
// 0xffffffff. The "Labels" table holds the label of every id as its text, which is how extraction
// can show names instead of numbers. Western tables are Windows-1252; others are UTF-8.

const MAGIC = 0x00039000
const ROWS = 0x24

interface Row {
  id: number
  offset: number
  raw: Buffer
}

interface Table {
  rows: Row[]
  /** Bytes after the last string. */
  tail: Buffer
  utf8: boolean
}

export function labelId(label: string): number {
  let hash = 0xffffffff
  for (const byte of Buffer.from(label, 'latin1')) hash = (Math.imul(hash, 33) + byte) >>> 0
  return hash
}

/** Windows-1252 differs from Latin-1 only in 0x80..0x9f. */
const CP1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ'

function decode(raw: Buffer, utf8: boolean): string {
  if (utf8) return raw.toString('utf8')
  let text = ''
  for (const byte of raw) {
    text += byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte)
  }
  return text
}

function encode(text: string, utf8: boolean): Buffer {
  if (utf8) return Buffer.from(text, 'utf8')
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    const high = CP1252_HIGH.indexOf(char)
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code)
    else if (high >= 0) bytes.push(0x80 + high)
    else throw new Error(`the character "${char}" cannot be shown by this language's text table`)
  }
  return Buffer.from(bytes)
}

export function isTextTable(file: Buffer): boolean {
  if (file.length < ROWS || file.readUInt32LE(0) !== MAGIC) return false
  const count = file.readUInt32LE(8)
  const strings = 8 + file.readUInt32LE(0x10)
  return file.readUInt32LE(4) === file.length - 8 && strings === ROWS + count * 8 && strings <= file.length
}

function parse(file: Buffer): Table {
  if (!isTextTable(file)) throw new Error('not a text table')
  const count = file.readUInt32LE(8)
  const strings = ROWS + count * 8
  const rows: Row[] = []
  let end = strings
  for (let i = 0; i < count; i++) {
    const offset = file.readUInt32LE(ROWS + i * 8 + 4)
    const stop = file.indexOf(0, strings + offset)
    if (stop < 0) throw new Error('text table is damaged')
    rows.push({ id: file.readUInt32LE(ROWS + i * 8), offset, raw: file.subarray(strings + offset, stop) })
    end = Math.max(end, stop + 1)
  }
  // UTF-8 only if every string survives a round trip through it; otherwise the table is Windows-1252.
  const utf8 =
    rows.some((row) => row.raw.some((byte) => byte >= 0x80)) &&
    rows.every((row) => Buffer.from(row.raw.toString('utf8'), 'utf8').equals(row.raw))
  return { rows, tail: file.subarray(end), utf8 }
}

function build(original: Buffer, table: Table): Buffer {
  // Ids must be unique and ascending: the game searches them. Strings keep their original order.
  const rows = [...table.rows].sort((a, b) => a.id - b.id)
  const placed = new Map<number, number>()
  const parts: Buffer[] = []
  let position = 0
  for (const row of [...table.rows].sort((a, b) => a.offset - b.offset)) {
    placed.set(row.id, position)
    parts.push(row.raw, Buffer.from([0]))
    position += row.raw.length + 1
  }
  const head = Buffer.from(original.subarray(0, ROWS))
  const index = Buffer.alloc(rows.length * 8)
  rows.forEach((row, i) => {
    index.writeUInt32LE(row.id, i * 8)
    index.writeUInt32LE(placed.get(row.id)!, i * 8 + 4)
  })
  const out = Buffer.concat([head, index, ...parts, table.tail])
  out.writeUInt32LE(out.length - 8, 4)
  out.writeUInt32LE(rows.length, 8)
  out.writeUInt32LE(ROWS + index.length - 8, 0x10)
  return out
}

/** A key in a strings file: a label, or "#1a2b3c4d" for a row known only by its id. */
function idOf(key: string): number {
  const numbered = /^#([0-9a-f]{1,8})$/i.exec(key)
  return numbered ? parseInt(numbered[1], 16) : labelId(key)
}

/**
 * Changes or adds text. `strings` maps labels (or "#id") to the new text; a label the table does not
 * have yet becomes a new row.
 */
export function applyStrings(file: Buffer, strings: Map<string, string>): Buffer {
  const table = parse(file)
  const byId = new Map(table.rows.map((row) => [row.id, row]))
  let next = Math.max(0, ...table.rows.map((row) => row.offset + row.raw.length + 1))
  for (const [key, text] of strings) {
    let raw: Buffer
    try {
      raw = encode(text, table.utf8)
    } catch (error) {
      throw new Error(`${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (raw.includes(0)) throw new Error(`${key}: text cannot contain a NUL character`)
    const row = byId.get(idOf(key))
    if (row) row.raw = raw
    else {
      // New strings go after the existing ones.
      const added = { id: idOf(key), offset: next, raw }
      next += raw.length + 1
      table.rows.push(added)
      byId.set(added.id, added)
    }
  }
  return build(file, table)
}

/**
 * Lists a table as label -> text for mod authors. `labels` is the Labels table of the same archive,
 * when there is one; rows without a label are keyed "#<id>".
 */
export function exportStrings(file: Buffer, labels: Buffer | null): Record<string, string> {
  const table = parse(file)
  const names = new Map<number, string>()
  if (labels && isTextTable(labels)) {
    for (const row of parse(labels).rows) names.set(row.id, row.raw.toString('latin1'))
  }
  const out: Record<string, string> = {}
  for (const row of table.rows) {
    const label = names.get(row.id)
    // Only trust a label that really hashes to this id.
    const key = label && labelId(label) === row.id ? label : `#${row.id.toString(16).padStart(8, '0')}`
    out[key] = decode(row.raw, table.utf8)
  }
  return out
}
