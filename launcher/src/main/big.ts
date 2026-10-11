import { open, stat, type FileHandle } from 'node:fs/promises'

// Skate 3's "EB" .big archives (big-endian):
//
//   0x00 "EB", u16 version (3)       0x04 u32 entry count
//   0x0a u8 shift: data offsets are stored divided by (1 << shift)
//   0x0c u32 name table offset       0x10 u32 size of names + folders
//   0x14 u8 name record length       0x15 u8 folder record length
//   0x16 u16 folder count            0x1c u32 archive size
//   0x30 index: 16 bytes per entry { offset, packed size (0 = stored), size, hash }, sorted by hash
//        then one flag byte per entry
//   names (16-byte aligned): per entry { u16 folder index, name }
//   folders (8-byte aligned): fixed-length folder paths
//
// The hash is djb2 over "<folder>/<name>". Packed entries are "chunkref" containers of RefPack
// chunks (or a bare RefPack stream).

export interface BigEntry {
  /** "<folder>/<name>", or "#<hash>" in archives that carry no names. */
  path: string
  offset: number
  /** 0 when the entry is stored as-is. */
  packedSize: number
  size: number
  hash: number
}

interface Row extends BigEntry {
  flag: number
  /** Raw name record, empty in archives without names. */
  name: Buffer
}

export interface BigArchive {
  entries: BigEntry[]
  size: number
}

interface Parsed {
  head: Buffer
  rows: Row[]
  unit: number
  nameLen: number
  folderLen: number
  folders: string[]
  dataStart: number
  size: number
}

const HEADER = 0x30
const CHUNK = 0x20000
const CHUNK_ALIGN = 0x10
const COPY_BLOCK = 8 << 20

const align = (value: number, to: number): number => Math.ceil(value / to) * to

export function pathHash(path: string): number {
  let hash = 5381
  for (const byte of Buffer.from(path, 'latin1')) hash = (Math.imul(hash, 33) + byte) >>> 0
  return hash
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await file.read(buffer, 0, length, position)
  if (bytesRead !== length) throw new Error('Archive is truncated.')
  return buffer
}

const cString = (buffer: Buffer, start: number, max: number): string => {
  const end = buffer.indexOf(0, start)
  return buffer.toString('latin1', start, end < 0 || end > start + max ? start + max : end)
}

async function parse(file: FileHandle): Promise<Parsed | null> {
  const size = (await file.stat()).size
  if (size < HEADER) return null
  const head = await readAt(file, 0, HEADER)
  if (head.toString('latin1', 0, 2) !== 'EB') return null

  const count = head.readUInt32BE(4)
  const unit = 2 ** head[0x0a]
  const namesAt = head.readUInt32BE(0x0c)
  const nameLen = head[0x14]
  const folderLen = head[0x15]
  const folderCount = head.readUInt16BE(0x16)

  const index = await readAt(file, HEADER, count * 17)
  let names: Buffer = Buffer.alloc(0)
  let folders: string[] = []
  if (nameLen) {
    const foldersAt = align(namesAt + count * nameLen, 8)
    names = await readAt(file, namesAt, foldersAt - namesAt + folderCount * folderLen)
    folders = Array.from({ length: folderCount }, (_, i) =>
      cString(names, foldersAt - namesAt + i * folderLen, folderLen)
    )
  }

  const rows: Row[] = []
  for (let i = 0; i < count; i++) {
    const hash = index.readUInt32BE(i * 16 + 12)
    const name = names.subarray(i * nameLen, (i + 1) * nameLen)
    let path = `#${hash.toString(16).padStart(8, '0')}`
    if (nameLen) {
      const folder = folders[name.readUInt16BE(0)] ?? ''
      const leaf = cString(name, 2, nameLen - 2)
      path = folder ? `${folder}/${leaf}` : leaf
    }
    rows.push({
      path,
      offset: index.readUInt32BE(i * 16) * unit,
      packedSize: index.readUInt32BE(i * 16 + 4),
      size: index.readUInt32BE(i * 16 + 8),
      hash,
      flag: index[count * 16 + i],
      name: Buffer.from(name)
    })
  }
  const dataStart = rows.length ? Math.min(...rows.map((row) => row.offset)) : align(HEADER, unit)
  return { head, rows, unit, nameLen, folderLen, folders, dataStart, size }
}

/** Reads an archive's index; null when the file is not an EB archive. */
export async function openBig(path: string): Promise<BigArchive | null> {
  const file = await open(path, 'r')
  try {
    const parsed = await parse(file)
    if (!parsed) return null
    return {
      size: parsed.size,
      entries: parsed.rows.map(({ path, offset, packedSize, size, hash }) => ({
        path,
        offset,
        packedSize,
        size,
        hash
      }))
    }
  } finally {
    await file.close()
  }
}

// ---------- decompression ----------

function refpack(source: Buffer): Buffer {
  if (source[1] !== 0xfb) throw new Error('Unknown compression.')
  let p = 2
  const wide = (source[0] & 0x80) !== 0
  if (source[0] & 0x01) p += wide ? 4 : 3
  const size = wide ? source.readUInt32BE(p) : source.readUIntBE(p, 3)
  p += wide ? 4 : 3
  const out = Buffer.alloc(size)
  let o = 0
  for (;;) {
    const b0 = source[p++]
    let literal: number
    let length = 0
    let distance = 0
    if (b0 < 0x80) {
      const b1 = source[p++]
      literal = b0 & 3
      length = ((b0 & 0x1c) >> 2) + 3
      distance = ((b0 & 0x60) << 3) + b1 + 1
    } else if (b0 < 0xc0) {
      const b1 = source[p++]
      const b2 = source[p++]
      literal = b1 >> 6
      length = (b0 & 0x3f) + 4
      distance = ((b1 & 0x3f) << 8) + b2 + 1
    } else if (b0 < 0xe0) {
      const b1 = source[p++]
      const b2 = source[p++]
      const b3 = source[p++]
      literal = b0 & 3
      length = ((b0 & 0x0c) << 6) + b3 + 5
      distance = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1
    } else if (b0 < 0xfc) {
      literal = ((b0 & 0x1f) << 2) + 4
    } else {
      literal = b0 & 3
      source.copy(out, o, p, p + literal)
      o += literal
      break
    }
    source.copy(out, o, p, p + literal)
    p += literal
    o += literal
    for (let i = 0; i < length; i++, o++) out[o] = out[o - distance]
  }
  if (o !== size) throw new Error('Compressed data is damaged.')
  return out
}

function unpack(packed: Buffer): Buffer {
  if (packed.toString('latin1', 0, 8) !== 'chunkref') return refpack(packed)
  const size = packed.readUInt32BE(0x0c)
  const count = packed.readUInt32BE(0x14)
  const alignment = packed.readUInt32BE(0x18)
  const parts: Buffer[] = []
  let header = 0x28
  for (let i = 0; i < count; i++) {
    const length = packed.readUInt32BE(header)
    const kind = packed.readUInt32BE(header + 4)
    const data = packed.subarray(header + 8, header + 8 + length)
    parts.push(kind === 2 ? refpack(data) : data)
    header = align(header + 8 + length + 8, alignment) - 8
  }
  const out = Buffer.concat(parts)
  if (out.length !== size) throw new Error('Compressed data is damaged.')
  return out
}

/** Returns an entry's contents, decompressed. */
export async function readEntry(archivePath: string, entry: BigEntry): Promise<Buffer> {
  const file = await open(archivePath, 'r')
  try {
    const raw = await readAt(file, entry.offset, entry.packedSize || entry.size)
    return entry.packedSize ? unpack(raw) : raw
  } finally {
    await file.close()
  }
}

// ---------- writing ----------

/** A valid RefPack stream that stores the data without compressing it (the game accepts these). */
function refpackStore(data: Buffer): Buffer {
  const parts: Buffer[] = [
    Buffer.from([0x10, 0xfb, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255])
  ]
  let p = 0
  while (data.length - p >= 4) {
    const run = Math.min(112, (data.length - p) & ~3)
    parts.push(Buffer.from([0xe0 + (run - 4) / 4]), data.subarray(p, p + run))
    p += run
  }
  parts.push(Buffer.from([0xfc + (data.length - p)]), data.subarray(p))
  return Buffer.concat(parts)
}

function chunkrefStore(data: Buffer): Buffer {
  const chunks: Buffer[] = []
  for (let p = 0; p < data.length; p += CHUNK) {
    chunks.push(refpackStore(data.subarray(p, Math.min(p + CHUNK, data.length))))
  }
  const head = Buffer.alloc(0x28)
  head.write('chunkref', 0, 'latin1')
  head.writeUInt32BE(2, 8)
  head.writeUInt32BE(data.length, 0x0c)
  head.writeUInt32BE(CHUNK, 0x10)
  head.writeUInt32BE(chunks.length, 0x14)
  head.writeUInt32BE(CHUNK_ALIGN, 0x18)
  const parts: Buffer[] = [head]
  let length = head.length
  chunks.forEach((chunk, i) => {
    const chunkHead = Buffer.alloc(8)
    chunkHead.writeUInt32BE(chunk.length, 0)
    chunkHead.writeUInt32BE(2, 4)
    parts.push(chunkHead, chunk)
    length += 8 + chunk.length
    if (i < chunks.length - 1) {
      // Each chunk's data starts on an aligned offset.
      const next = align(length + 8, CHUNK_ALIGN) - 8
      parts.push(Buffer.alloc(next - length))
      length = next
    }
  })
  return Buffer.concat(parts)
}

const extensionOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase()

/**
 * Writes a copy of an archive with entries replaced or added. `changes` maps entry paths to their
 * new (uncompressed) contents; paths match existing entries case-insensitively. Existing data keeps
 * its bytes: changed entries are appended and the index is rewritten.
 */
export async function patchBig(
  sourcePath: string,
  targetPath: string,
  changes: Map<string, Buffer>
): Promise<void> {
  const source = await open(sourcePath, 'r')
  try {
    const parsed = await parse(source)
    if (!parsed) throw new Error('Not a Skate 3 archive.')
    const { head, rows, unit, nameLen, folderLen, dataStart } = parsed
    const folders = [...parsed.folders]
    const byPath = new Map(rows.map((row) => [row.path.toLowerCase(), row]))

    const appended: { row: Row; payload: Buffer }[] = []
    for (const [path, contents] of changes) {
      let row = byPath.get(path.toLowerCase())
      let model: Row | undefined
      if (!row) {
        if (!nameLen) throw new Error(`This archive has no file names, so "${path}" cannot be added to it.`)
        const slash = path.lastIndexOf('/')
        const folder = slash < 0 ? '' : path.slice(0, slash)
        const leaf = path.slice(slash + 1)
        let folderIndex = folders.findIndex((known) => known.toLowerCase() === folder.toLowerCase())
        if (folderIndex < 0) {
          if (folder.length >= folderLen) throw new Error(`Folder name is too long for this archive: ${folder}`)
          folderIndex = folders.push(folder) - 1
        }
        if (leaf.length > nameLen - 3) throw new Error(`File name is too long for this archive: ${leaf}`)
        const name = Buffer.alloc(nameLen)
        name.writeUInt16BE(folderIndex, 0)
        name.write(leaf, 2, 'latin1')
        const exact = folders[folderIndex] ? `${folders[folderIndex]}/${leaf}` : leaf
        // New files are stored the way the archive stores others of their kind.
        model = rows.find((other) => extensionOf(other.path) === extensionOf(leaf)) ?? rows[0]
        row = {
          path: exact,
          offset: 0,
          packedSize: model?.packedSize ? 1 : 0,
          size: 0,
          hash: pathHash(exact),
          flag: model?.flag ?? 0,
          name
        }
        if (rows.some((other) => other.hash === row!.hash)) {
          throw new Error(`"${path}" collides with another file name in this archive.`)
        }
        rows.push(row)
        byPath.set(path.toLowerCase(), row)
      }
      // Packed entries keep the container the archive uses for them: chunked, or one bare stream.
      let payload = contents
      if (row.packedSize) {
        const like = row.offset ? row : model
        const chunked = !like?.offset || (await readAt(source, like.offset, 8)).toString('latin1') === 'chunkref'
        if (!chunked && contents.length > 0xffffff) throw new Error(`"${path}" is too large for this archive.`)
        payload = chunked ? chunkrefStore(contents) : refpackStore(contents)
      }
      row.packedSize = row.packedSize ? payload.length : 0
      row.size = contents.length
      appended.push({ row, payload })
    }
    rows.sort((a, b) => a.hash - b.hash)

    // Lay the index region out again; if it outgrew the gap before the data, the data moves down.
    const count = rows.length
    let regionEnd = HEADER + count * 17
    let namesAt = head.readUInt32BE(0x0c)
    let foldersAt = 0
    if (nameLen) {
      namesAt = align(regionEnd, 16)
      foldersAt = align(namesAt + count * nameLen, 8)
      regionEnd = align(foldersAt + folders.length * folderLen, 16)
    }
    const slide = Math.max(0, align(regionEnd, unit) - dataStart)
    let end = align(parsed.size + slide, unit)
    for (const item of appended) {
      item.row.offset = end - slide
      end = align(end + item.payload.length, unit)
    }
    if (end / unit > 0xffffffff) throw new Error('The archive would become too large.')

    const region = Buffer.alloc(dataStart + slide)
    head.copy(region)
    region.writeUInt32BE(count, 4)
    region.writeUInt32BE(end, 0x1c)
    if (nameLen) {
      region.writeUInt32BE(namesAt, 0x0c)
      region.writeUInt32BE(regionEnd - namesAt, 0x10)
      region.writeUInt16BE(folders.length, 0x16)
    }
    rows.forEach((row, i) => {
      region.writeUInt32BE((row.offset + slide) / unit, HEADER + i * 16)
      region.writeUInt32BE(row.packedSize, HEADER + i * 16 + 4)
      region.writeUInt32BE(row.size, HEADER + i * 16 + 8)
      region.writeUInt32BE(row.hash, HEADER + i * 16 + 12)
      region[HEADER + count * 16 + i] = row.flag
      if (nameLen) row.name.copy(region, namesAt + i * nameLen)
    })
    folders.forEach((folder, i) => region.write(folder, foldersAt + i * folderLen, 'latin1'))

    const target = await open(targetPath, 'w')
    try {
      await target.write(region, 0, region.length, 0)
      const block = Buffer.alloc(COPY_BLOCK)
      for (let position = dataStart; position < parsed.size; ) {
        const { bytesRead } = await source.read(block, 0, Math.min(COPY_BLOCK, parsed.size - position), position)
        if (!bytesRead) throw new Error('Archive is truncated.')
        await target.write(block, 0, bytesRead, position + slide)
        position += bytesRead
      }
      for (const { row, payload } of appended) await target.write(payload, 0, payload.length, row.offset + slide)
      await target.truncate(end)
    } finally {
      await target.close()
    }
    if ((await stat(targetPath)).size !== end) throw new Error('Writing the archive failed.')
  } finally {
    await source.close()
  }
}
