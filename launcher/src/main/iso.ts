import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { InstallProgress, Result } from '@shared/types'
import { findIso, gameRoot, isRunning, notifyStatusChanged } from './game'
import { hasAppliedMods } from './mods'

// Extracts the game files from an Xbox 360 disc image (XDVDFS), the same way
// the game's own installer does (src/skate3_iso_installer.cpp). Doing it here
// gives a progress bar; the game's unattended install freezes its window.

const SECTOR = 2048
/** Byte offsets at which the game partition can start, by disc format. */
const GAME_OFFSETS = [0x0, 0xfb20, 0x20600, 0x2080000, 0xfd90000]
const MAGIC = 'MICROSOFT*XBOX*MEDIA'
const DEFAULT_XEX = 'default.xex'
const DIRECTORY_ATTRIBUTE = 0x10
const COPY_CHUNK = 4 * 1024 * 1024
const MAX_ENTRIES = 500000

interface IsoEntry {
  path: string
  offset: number
  size: number
}

let installing = false

async function readAt(file: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await file.read(buffer, 0, length, offset)
  if (bytesRead !== length) throw new Error('The ISO is truncated or unreadable.')
  return buffer
}

async function findGameOffset(file: FileHandle, fileSize: number): Promise<number> {
  for (const candidate of GAME_OFFSETS) {
    const at = candidate + 32 * SECTOR
    if (at + MAGIC.length > fileSize) continue
    if ((await readAt(file, at, MAGIC.length)).toString('latin1') === MAGIC) return candidate
  }
  throw new Error('The selected file is not a recognized Xbox 360 game ISO.')
}

/** Walks the directory tree; each directory is a binary tree of entries. */
async function listEntries(file: FileHandle, gameOffset: number): Promise<IsoEntry[]> {
  const rootInfo = await readAt(file, gameOffset + 32 * SECTOR + 20, 8)
  const rootSize = rootInfo.readUInt32LE(4)
  if (rootSize < 13 || rootSize > 32 * 1024 * 1024) {
    throw new Error('The ISO root directory is invalid.')
  }

  const entries: IsoEntry[] = []
  const pending = [
    { directory: gameOffset + rootInfo.readUInt32LE(0) * SECTOR, node: 0, prefix: '' }
  ]
  for (let visited = 0; pending.length > 0; visited++) {
    if (visited > MAX_ENTRIES) throw new Error('The ISO directory tree is unexpectedly large.')
    const { directory, node, prefix } = pending.pop()!
    const header = await readAt(file, directory + node, 14)
    const left = header.readUInt16LE(0)
    const right = header.readUInt16LE(2)
    const sector = header.readUInt32LE(4)
    const length = header.readUInt32LE(8)
    const nameLength = header[13]
    if (nameLength === 0 || nameLength > 240) {
      throw new Error('The ISO contains an invalid directory entry.')
    }
    const name = (await readAt(file, directory + node + 14, nameLength)).toString('latin1')
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      throw new Error('The ISO contains an unsafe file path.')
    }

    if (left) pending.push({ directory, node: left * 4, prefix })
    if (right) pending.push({ directory, node: right * 4, prefix })
    if (header[12] & DIRECTORY_ATTRIBUTE) {
      if (length) pending.push({ directory: gameOffset + sector * SECTOR, node: 0, prefix: `${prefix}${name}/` })
    } else {
      entries.push({ path: prefix + name, offset: gameOffset + sector * SECTOR, size: length })
    }
  }
  return entries
}

async function extract(
  isoPath: string,
  target: string,
  onProgress: (progress: InstallProgress) => void
): Promise<void> {
  const file = await open(isoPath, 'r')
  try {
    const fileSize = (await file.stat()).size
    const entries = await listEntries(file, await findGameOffset(file, fileSize))
    const isExecutable = (entry: IsoEntry): boolean => entry.path.toLowerCase() === DEFAULT_XEX
    if (!entries.some(isExecutable)) throw new Error('The ISO does not contain default.xex.')
    // default.xex is what marks the game as installed, so it is written last:
    // an interrupted install is then simply started again.
    entries.sort((a, b) => Number(isExecutable(a)) - Number(isExecutable(b)))

    const total = entries.reduce((sum, entry) => sum + entry.size, 0)
    const buffer = Buffer.alloc(COPY_CHUNK)
    let copied = 0
    for (const entry of entries) {
      if (entry.offset + entry.size > fileSize) throw new Error('The ISO is truncated.')
      const path = join(target, entry.path)
      await mkdir(dirname(path), { recursive: true })
      const out = await open(path, 'w')
      try {
        for (let done = 0; done < entry.size; ) {
          const chunk = Math.min(COPY_CHUNK, entry.size - done)
          const { bytesRead } = await file.read(buffer, 0, chunk, entry.offset + done)
          if (bytesRead !== chunk) throw new Error(`Failed to read ${entry.path} from the ISO.`)
          await out.write(buffer, 0, chunk)
          done += chunk
          copied += chunk
          onProgress({ phase: 'game', fraction: total ? copied / total : 1 })
        }
      } finally {
        await out.close()
      }
    }
  } finally {
    await file.close()
  }
}

/** Installs the game files beside the executable from the user's ISO. */
export async function installGameFiles(
  onProgress: (progress: InstallProgress | null) => void
): Promise<Result> {
  if (installing) return { ok: false, error: 'An install is already in progress.' }
  if (isRunning()) return { ok: false, error: 'Close Skate 3 before installing the game files.' }
  const root = gameRoot()
  const iso = findIso()
  if (!root) return { ok: false, error: 'Install the Skate 3 build first.' }
  if (!iso) return { ok: false, error: 'Choose your Skate 3 ISO first.' }
  // Reinstalling overwrites game files that enabled mods have replaced.
  if (await hasAppliedMods()) {
    return { ok: false, error: 'Switch off all mods before reinstalling the game files.' }
  }

  installing = true
  try {
    onProgress({ phase: 'game', fraction: 0 })
    await extract(iso, root, onProgress)
    return { ok: true }
  } finally {
    installing = false
    onProgress(null)
    notifyStatusChanged()
  }
}
