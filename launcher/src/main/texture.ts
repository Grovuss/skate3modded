import { crc32, deflateSync } from 'node:zlib'

// Decodes the Xbox 360 textures held in RenderWare 4 arenas (.rx2 files) so they can be saved as PNG.

export interface DecodedTexture {
  width: number
  height: number
  /** e.g. "DXT5 tiled". */
  format: string
  /** Null for formats the decoder does not handle. */
  rgba: Buffer | null
}

export const TEXTURE_OBJECT = 0x000200e8
export type Kind = '8888' | 'L8' | 'DXT1' | 'DXT3' | 'DXT5' | 'DXT5A' | 'DXN'
/** GPU format id -> [kind, bytes per block, pixels per block side]. */
export const FORMATS: Record<number, [Kind, number, number]> = {
  0x02: ['L8', 1, 1],
  0x06: ['8888', 4, 1],
  0x12: ['DXT1', 8, 4],
  0x13: ['DXT3', 16, 4],
  0x14: ['DXT5', 16, 4],
  0x31: ['DXN', 16, 4],
  0x3a: ['DXT5A', 8, 4]
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Xbox 360 tiled-surface addressing (as documented by the Xenia project).
export function tiledRow(y: number, width: number, log2: number): number {
  const macro = (Math.floor(y / 32) * Math.floor(width / 32)) << (log2 + 7)
  const micro = ((y & 6) << 2) << log2
  return macro + ((micro & ~0xf) << 1) + (micro & 0xf) + ((y & 8) << (3 + log2)) + ((y & 1) << 4)
}
export function tiledColumn(x: number, y: number, log2: number, base: number): number {
  const macro = Math.floor(x / 32) << (log2 + 7)
  const micro = (x & 7) << log2
  const offset = base + (macro + ((micro & ~0xf) << 1) + (micro & 0xf))
  return (
    ((offset & ~0x1ff) << 3) +
    ((offset & 0x1c0) << 2) +
    (offset & 0x3f) +
    ((y & 16) << 7) +
    (((((y & 8) >> 2) + (x >> 3)) & 3) << 6)
  )
}

export const rgb565 = (c: number): number[] =>
  [(((c >> 11) & 31) * 255) / 31, (((c >> 5) & 63) * 255) / 63, ((c & 31) * 255) / 31].map(Math.round)

type Put = (x: number, y: number, pixel: number[]) => void

function decodeBlock(kind: Kind, b: Buffer, put: Put): void {
  let alpha: number[] | null = null
  let colorAt = 0
  if (kind === 'DXT3') {
    alpha = Array.from({ length: 16 }, (_, i) => ((b[i >> 1] >> ((i & 1) * 4)) & 15) * 17)
    colorAt = 8
  } else if (kind === 'DXT5' || kind === 'DXT5A') {
    const a0 = b[0]
    const a1 = b[1]
    const table = [a0, a1]
    const steps = a0 > a1 ? 7 : 5
    for (let i = 1; i < steps; i++) table.push(Math.round(((steps - i) * a0 + i * a1) / steps))
    if (a0 <= a1) table.push(0, 255)
    let bits = 0n
    for (let i = 0; i < 6; i++) bits |= BigInt(b[2 + i]) << BigInt(8 * i)
    alpha = Array.from({ length: 16 }, (_, i) => table[Number((bits >> BigInt(3 * i)) & 7n)])
    colorAt = 8
    if (kind === 'DXT5A') {
      for (let i = 0; i < 16; i++) put(i & 3, i >> 2, [255, 255, 255, alpha[i]])
      return
    }
  }
  const c0 = b[colorAt] | (b[colorAt + 1] << 8)
  const c1 = b[colorAt + 2] | (b[colorAt + 3] << 8)
  const p0 = rgb565(c0)
  const p1 = rgb565(c1)
  const four = kind !== 'DXT1' || c0 > c1
  const palette = [
    [...p0, 255],
    [...p1, 255],
    four
      ? [...p0.map((v, i) => Math.round((2 * v + p1[i]) / 3)), 255]
      : [...p0.map((v, i) => Math.round((v + p1[i]) / 2)), 255],
    four ? [...p0.map((v, i) => Math.round((v + 2 * p1[i]) / 3)), 255] : [0, 0, 0, 0]
  ]
  for (let i = 0; i < 16; i++) {
    const pixel = [...palette[(b[colorAt + 4 + (i >> 2)] >> ((i & 3) * 2)) & 3]]
    if (alpha) pixel[3] = alpha[i]
    put(i & 3, i >> 2, pixel)
  }
}

function decodeTexture(arena: Buffer, at: number, data: Buffer): DecodedTexture {
  // The GPU "fetch constant" describing the texture sits 28 bytes into the object.
  const word = (i: number): number => arena.readUInt32BE(at + 28 + i * 4)
  const tiled = word(0) >>> 31 === 1
  const format = word(1) & 0x3f
  const endian = (word(1) >> 6) & 3
  const width = (word(2) & 0x1fff) + 1
  const height = ((word(2) >> 13) & 0x1fff) + 1
  const info = FORMATS[format]
  if (!info || info[0] === 'DXN') {
    return { width, height, format: info?.[0] ?? `0x${format.toString(16)}`, rgba: null }
  }
  const [kind, blockBytes, blockDim] = info
  const blocksWide = Math.ceil(width / blockDim)
  const blocksHigh = Math.ceil(height / blockDim)
  const pitch = align32(blocksWide)
  const log2 = Math.log2(blockBytes)
  const source = Buffer.from(data)
  if (endian === 1) source.swap16()
  else if (endian === 2) source.swap32()

  const rgba = Buffer.alloc(width * height * 4)
  for (let by = 0; by < blocksHigh; by++) {
    const rowBase = tiled ? tiledRow(by, pitch, log2) : 0
    for (let bx = 0; bx < blocksWide; bx++) {
      const offset = tiled ? tiledColumn(bx, by, log2, rowBase) : (by * pitch + bx) * blockBytes
      if (offset + blockBytes > source.length) continue
      const block = source.subarray(offset, offset + blockBytes)
      const put: Put = (x, y, pixel) => {
        const px = bx * blockDim + x
        const py = by * blockDim + y
        if (px < width && py < height) rgba.set(pixel, (py * width + px) * 4)
      }
      if (kind === '8888') put(0, 0, [block[2], block[1], block[0], block[3]])
      else if (kind === 'L8') put(0, 0, [block[0], block[0], block[0], 255])
      else decodeBlock(kind, block, put)
    }
  }
  return { width, height, format: `${kind}${tiled ? ' tiled' : ''}`, rgba }
}

export const align32 = (value: number): number => Math.ceil(value / 32) * 32

/** Decodes every texture in an arena; empty when the file is not an RW4 arena. */
export function decodeTextures(arena: Buffer): DecodedTexture[] {
  if (arena.length < 0x48 || arena.toString('latin1', 1, 4) !== 'RW4') return []
  const count = arena.readUInt32BE(0x20)
  const dictionary = arena.readUInt32BE(0x30)
  const resourceBase = arena.readUInt32BE(0x44)
  const textures: DecodedTexture[] = []
  let pixels: { pointer: number; size: number } | null = null
  for (let i = 0; i < count; i++) {
    const at = dictionary + i * 24
    if (at + 24 > arena.length) break
    const pointer = arena.readUInt32BE(at)
    const size = arena.readUInt32BE(at + 8)
    const type = arena.readUInt32BE(at + 20)
    // A texture object follows the raw resource that holds its pixels.
    if (type >>> 8 === 0x100 && (type & 0xff) >= 0x30) pixels = { pointer, size }
    else if (type === TEXTURE_OBJECT && pixels) {
      const start = resourceBase + pixels.pointer
      textures.push(decodeTexture(arena, pointer, arena.subarray(start, start + pixels.size)))
    }
  }
  return textures
}
