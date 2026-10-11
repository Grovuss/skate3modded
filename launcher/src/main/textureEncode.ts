import { inflateSync } from 'node:zlib'
import {
  FORMATS,
  TEXTURE_OBJECT,
  align32,
  decodeTextures,
  rgb565,
  tiledColumn,
  tiledRow,
  type Kind
} from './texture'

// Turns PNG images back into the textures of an RW4 arena (.rx2), the reverse of texture.ts.

export interface Image {
  width: number
  height: number
  rgba: Buffer
}

/** Reads an 8-bit, non-interlaced PNG (greyscale, RGB, palette, with or without alpha). */
export function decodePng(file: Buffer): Image {
  if (file.length < 33 || file.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG image.')
  let width = 0
  let height = 0
  let colorType = -1
  let palette: Buffer | null = null
  let transparency: Buffer | null = null
  const data: Buffer[] = []
  for (let p = 8; p + 12 <= file.length; ) {
    const length = file.readUInt32BE(p)
    const type = file.toString('latin1', p + 4, p + 8)
    const body = file.subarray(p + 8, p + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      colorType = body[9]
      if (body[8] !== 8) throw new Error('Only 8-bit PNG images are supported: save it as 8 bits per channel.')
      if (body[12] !== 0) throw new Error('Interlaced PNG images are not supported.')
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    p += 12 + length
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (!width || !height || !channels) throw new Error('Unsupported PNG image.')
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(data))
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is incomplete.')

  const rgba = Buffer.alloc(width * height * 4)
  let previous: Buffer = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      let predicted = 0
      if (filter === 1) predicted = left
      else if (filter === 2) predicted = up
      else if (filter === 3) predicted = (left + up) >> 1
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dLeft = Math.abs(estimate - left)
        const dUp = Math.abs(estimate - up)
        const dUpLeft = Math.abs(estimate - upLeft)
        predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
      }
      row[x] = (row[x] + predicted) & 255
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const o = (y * width + x) * 4
      if (colorType === 6) row.copy(rgba, o, s, s + 4)
      else if (colorType === 2) {
        row.copy(rgba, o, s, s + 3)
        rgba[o + 3] = 255
      } else if (colorType === 0 || colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[s]
        rgba[o + 3] = colorType === 4 ? row[s + 1] : 255
      } else {
        if (!palette) throw new Error('PNG palette is missing.')
        palette.copy(rgba, o, row[s] * 3, row[s] * 3 + 3)
        rgba[o + 3] = transparency && row[s] < transparency.length ? transparency[row[s]] : 255
      }
    }
    previous = row
  }
  return { width, height, rgba }
}

const to565 = (r: number, g: number, b: number): number => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)

/** Colour half of a DXT block. `cutout` uses DXT1's three-colour mode, whose fourth index is transparent. */
function encodeColor(pixels: number[][], block: Buffer, at: number, cutout: boolean): void {
  const solid = cutout ? pixels.filter((p) => p[3] >= 128) : pixels
  const pool = solid.length ? solid : pixels
  const luma = (p: number[]): number => p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114
  let low = pool[0]
  let high = pool[0]
  for (const p of pool) {
    if (luma(p) < luma(low)) low = p
    if (luma(p) > luma(high)) high = p
  }
  let c0 = to565(high[0], high[1], high[2])
  let c1 = to565(low[0], low[1], low[2])
  // Four-colour mode needs c0 > c1; three-colour mode needs c0 <= c1.
  if (cutout ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0]
  if (!cutout && c0 === c1) {
    if (c0 < 0xffff) c0++
    else c1--
  }
  const e0 = rgb565(c0)
  const e1 = rgb565(c1)
  const palette = cutout
    ? [e0, e1, e0.map((v, i) => (v + e1[i]) / 2)]
    : [e0, e1, e0.map((v, i) => (2 * v + e1[i]) / 3), e0.map((v, i) => (v + 2 * e1[i]) / 3)]
  block.writeUInt16LE(c0, at)
  block.writeUInt16LE(c1, at + 2)
  block.fill(0, at + 4, at + 8)
  pixels.forEach((p, i) => {
    let best = 0
    if (cutout && p[3] < 128) best = 3
    else {
      let bestDistance = Infinity
      palette.forEach((c, k) => {
        const distance = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = k
        }
      })
    }
    block[at + 4 + (i >> 2)] |= best << ((i & 3) * 2)
  })
}

/** Alpha half of a DXT5 block (also the whole of a DXT5A block). */
function encodeAlpha(pixels: number[][], block: Buffer): void {
  let min = 255
  let max = 0
  for (const p of pixels) {
    min = Math.min(min, p[3])
    max = Math.max(max, p[3])
  }
  block[0] = max
  block[1] = min
  const table = [max, min]
  if (max > min) for (let i = 1; i < 7; i++) table.push(((7 - i) * max + i * min) / 7)
  else table.push(max, max, max, max, 0, 255)
  let bits = 0n
  pixels.forEach((p, i) => {
    let best = 0
    for (let k = 1; k < 8; k++) if (Math.abs(table[k] - p[3]) < Math.abs(table[best] - p[3])) best = k
    bits |= BigInt(best) << BigInt(3 * i)
  })
  for (let i = 0; i < 6; i++) block[2 + i] = Number((bits >> BigInt(8 * i)) & 255n)
}

function encodeBlock(kind: Kind, pixels: number[][]): Buffer {
  if (kind === '8888') return Buffer.from([pixels[0][2], pixels[0][1], pixels[0][0], pixels[0][3]])
  if (kind === 'L8') return Buffer.from([pixels[0][0]])
  if (kind === 'DXT1') {
    const block = Buffer.alloc(8)
    encodeColor(pixels, block, 0, pixels.some((p) => p[3] < 128))
    return block
  }
  if (kind === 'DXT5A') {
    const block = Buffer.alloc(8)
    encodeAlpha(pixels, block)
    return block
  }
  const block = Buffer.alloc(16)
  if (kind === 'DXT3') {
    pixels.forEach((p, i) => (block[i >> 1] |= Math.round(p[3] / 17) << ((i & 1) * 4)))
  } else encodeAlpha(pixels, block)
  encodeColor(pixels, block, 8, false)
  return block
}

interface Level {
  size: number
  offset: number
  pitch: number
  /** Block position inside the shared area that holds the smallest levels. */
  x: number
}

/**
 * Where each mip level of a square tiled block-compressed texture lives in its resource: levels down
 * to 32 px get a tile-aligned area each, 16 px and smaller share one last area.
 */
function mipLayout(size: number, blockBytes: number): { levels: Level[]; total: number } {
  const levels: Level[] = []
  let offset = 0
  const area = (blocks: number): number => Math.max(32, align32(blocks)) ** 2 * blockBytes
  for (let dim = size; dim >= 4; dim >>= 1) {
    if (dim > 16) {
      levels.push({ size: dim, offset, pitch: Math.max(32, dim / 4), x: 0 })
      offset += area(dim / 4)
    } else levels.push({ size: dim, offset, pitch: 32, x: dim / 4 })
  }
  return { levels, total: offset + area(1) }
}

function halve(rgba: Buffer, size: number): Buffer {
  const half = size / 2
  const out = Buffer.alloc(half * half * 4)
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      for (let c = 0; c < 4; c++) {
        const s = (y * 2 * size + x * 2) * 4 + c
        out[(y * half + x) * 4 + c] =
          (rgba[s] + rgba[s + 4] + rgba[s + size * 4] + rgba[s + size * 4 + 4] + 2) >> 2
      }
    }
  }
  return out
}

function halveMask(mask: Uint8Array, size: number): Uint8Array {
  const half = size / 2
  const out = new Uint8Array(half * half)
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const s = y * 2 * size + x * 2
      out[y * half + x] = mask[s] | mask[s + 1] | mask[s + size] | mask[s + size + 1]
    }
  }
  return out
}

interface Located {
  /** Offset of the texture object in the arena. */
  object: number
  /** The texture's pixel resource within the arena. */
  start: number
  size: number
}

function locateTextures(arena: Buffer): Located[] {
  if (arena.length < 0x48 || arena.toString('latin1', 1, 4) !== 'RW4') return []
  const count = arena.readUInt32BE(0x20)
  const dictionary = arena.readUInt32BE(0x30)
  const resourceBase = arena.readUInt32BE(0x44)
  const found: Located[] = []
  let pixels: { pointer: number; size: number } | null = null
  for (let i = 0; i < count; i++) {
    const at = dictionary + i * 24
    if (at + 24 > arena.length) break
    const type = arena.readUInt32BE(at + 20)
    if (type >>> 8 === 0x100 && (type & 0xff) >= 0x30) {
      pixels = { pointer: arena.readUInt32BE(at), size: arena.readUInt32BE(at + 8) }
    } else if (type === TEXTURE_OBJECT && pixels) {
      found.push({ object: arena.readUInt32BE(at), start: resourceBase + pixels.pointer, size: pixels.size })
    }
  }
  return found
}

/**
 * Replaces textures of an arena with images of the same size; `images` is keyed by the texture's
 * position in the file (as numbered by extraction). Only blocks whose pixels differ from the current
 * texture are re-encoded, so untouched areas keep their original data. Returns the new arena and
 * notes about anything that could only partly be done.
 */
export function replaceTextures(
  arena: Buffer,
  images: Map<number, Image>
): { arena: Buffer; notes: string[] } {
  const out = Buffer.from(arena)
  const notes: string[] = []
  const located = locateTextures(out)
  const current = decodeTextures(out)
  for (const [number, image] of images) {
    const where = located[number]
    const before = current[number]
    if (!where || !before) throw new Error(`there is no texture ${number} in the file`)
    if (!before.rgba) throw new Error(`${before.format} textures cannot be replaced yet`)
    if (image.width !== before.width || image.height !== before.height) {
      throw new Error(
        `the image is ${image.width}x${image.height} but the texture is ${before.width}x${before.height}`
      )
    }
    const word = (i: number): number => out.readUInt32BE(where.object + 28 + i * 4)
    const tiled = word(0) >>> 31 === 1
    const endian = (word(1) >> 6) & 3
    const [kind, blockBytes, blockDim] = FORMATS[word(1) & 0x3f]
    const log2 = Math.log2(blockBytes)
    const data = out.subarray(where.start, where.start + where.size)

    const writeLevel = (level: Level, rgba: Buffer, changed: Uint8Array, width: number, height: number): void => {
      const blocksWide = Math.ceil(width / blockDim)
      const blocksHigh = Math.ceil(height / blockDim)
      for (let by = 0; by < blocksHigh; by++) {
        for (let bx = 0; bx < blocksWide; bx++) {
          const pixels: number[][] = []
          let touched = false
          for (let i = 0; i < blockDim * blockDim; i++) {
            const px = Math.min(width - 1, bx * blockDim + (i % blockDim))
            const py = Math.min(height - 1, by * blockDim + Math.floor(i / blockDim))
            touched ||= changed[py * width + px] === 1
            const s = (py * width + px) * 4
            pixels.push([rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]])
          }
          if (!touched) continue
          const x = bx + level.x
          const offset =
            level.offset +
            (tiled
              ? tiledColumn(x, by, log2, tiledRow(by, level.pitch, log2))
              : (by * level.pitch + x) * blockBytes)
          if (offset + blockBytes > data.length) continue
          const block = encodeBlock(kind, pixels)
          if (endian === 1 && block.length % 2 === 0) block.swap16()
          else if (endian === 2 && block.length % 4 === 0) block.swap32()
          block.copy(data, offset)
        }
      }
    }

    let changed: Uint8Array = new Uint8Array(image.width * image.height)
    let any = false
    for (let i = 0; i < changed.length; i++) {
      if (image.rgba.readUInt32LE(i * 4) !== before.rgba.readUInt32LE(i * 4)) {
        changed[i] = 1
        any = true
      }
    }
    if (!any) continue

    const basePitch = align32(Math.ceil(image.width / blockDim))
    const baseRows = Math.ceil(image.height / blockDim)
    const baseBytes = basePitch * (tiled ? align32(baseRows) : baseRows) * blockBytes
    const layout =
      blockDim === 4 && tiled && image.width === image.height
        ? mipLayout(image.width, blockBytes)
        : null
    if (layout && layout.total === where.size) {
      // Smaller versions of the texture, used at a distance, are rebuilt from the image too. The shared
      // area for 16 px and below is left alone: at that size the difference cannot be seen.
      let rgba = image.rgba
      for (const level of layout.levels) {
        if (level.size > 16) writeLevel(level, rgba, changed, level.size, level.size)
        if (level.size <= 4) break
        rgba = halve(rgba, level.size)
        changed = halveMask(changed, level.size)
      }
    } else {
      const base = { size: image.width, offset: 0, pitch: basePitch, x: 0 }
      writeLevel(base, image.rgba, changed, image.width, image.height)
      if (where.size > baseBytes) {
        notes.push(`texture ${number}: only the full-size image was replaced, so from far away the game may show the old one`)
      }
    }
  }
  return { arena: out, notes }
}
