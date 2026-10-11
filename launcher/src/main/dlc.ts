import { shell } from 'electron'
import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, open, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { DlcPackage, Result } from '@shared/types'
import { isDirectory, isRunning, userRoot } from './game'

// The game scans <user root>/dlc on boot and extracts each marketplace STFS
// package to <user root>/0000000000000000/<TITLE8>/00000002/<file name>, with
// a header file under .../Headers/00000002/ (InstallDlcPackages).

const STFS_MAGICS = new Set(['CON ', 'LIVE', 'PIRS'])
const CONTENT_TYPE_OFFSET = 0x344
const TITLE_ID_OFFSET = 0x360
const DISPLAY_NAME_OFFSET = 0x411
const DISPLAY_NAME_BYTES = 0x80
const MARKETPLACE_CONTENT = 2
const HEADER_BYTES = DISPLAY_NAME_OFFSET + DISPLAY_NAME_BYTES
const DLC_XUID = '0000000000000000'
const MARKETPLACE_DIR = '00000002'

export const dlcRoot = (): string => join(userRoot(), 'dlc')

interface StfsHeader {
  valid: boolean
  titleId: string | null
  displayName: string | null
}

async function readHeader(path: string): Promise<StfsHeader> {
  const none: StfsHeader = { valid: false, titleId: null, displayName: null }
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await file.read(buffer, 0, HEADER_BYTES, 0)
    if (bytesRead < HEADER_BYTES || !STFS_MAGICS.has(buffer.toString('latin1', 0, 4))) return none

    const name = Buffer.from(
      buffer.subarray(DISPLAY_NAME_OFFSET, DISPLAY_NAME_OFFSET + DISPLAY_NAME_BYTES)
    )
      .swap16()
      .toString('utf16le')
      .split('\0')[0]
      .trim()
    return {
      valid: buffer.readUInt32BE(CONTENT_TYPE_OFFSET) === MARKETPLACE_CONTENT,
      titleId: buffer.readUInt32BE(TITLE_ID_OFFSET).toString(16).toUpperCase().padStart(8, '0'),
      displayName: name || null
    }
  } finally {
    await file.close()
  }
}

async function walk(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** Installed copies of a package: its extracted folder and header file, per title. */
async function installedPaths(fileName: string, titleId: string | null): Promise<string[]> {
  const contentRoot = join(userRoot(), DLC_XUID)
  let titles: string[] = []
  if (titleId) {
    titles = [titleId]
  } else {
    try {
      titles = await readdir(contentRoot)
    } catch {
      // Nothing installed yet.
    }
  }
  return titles
    .flatMap((title) => [
      join(contentRoot, title, MARKETPLACE_DIR, fileName),
      join(contentRoot, title, 'Headers', MARKETPLACE_DIR, `${fileName}.header`)
    ])
    .filter((path) => existsSync(path))
}

export async function listDlc(): Promise<DlcPackage[]> {
  if (!isDirectory(dlcRoot())) return []
  const packages: DlcPackage[] = []
  for (const path of await walk(dlcRoot())) {
    const header = await readHeader(path).catch(
      (): StfsHeader => ({ valid: false, titleId: null, displayName: null })
    )
    const fileName = relative(dlcRoot(), path)
    packages.push({
      fileName,
      path,
      sizeBytes: (await stat(path)).size,
      displayName: header.displayName,
      valid: header.valid,
      installed:
        header.valid && (await installedPaths(basename(path), header.titleId)).length > 0
    })
  }
  return packages.sort((a, b) => a.fileName.localeCompare(b.fileName))
}

export async function addDlc(sources: string[]): Promise<Result> {
  await mkdir(dlcRoot(), { recursive: true })
  const skipped: string[] = []
  for (const source of sources) {
    try {
      await copyFile(source, join(dlcRoot(), basename(source)), constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      skipped.push(basename(source))
    }
  }
  return skipped.length
    ? { ok: false, error: `Already in the DLC folder, not replaced: ${skipped.join(', ')}` }
    : { ok: true }
}

export async function removeDlc(fileName: string): Promise<Result> {
  if (isRunning()) return { ok: false, error: 'Close Skate 3 before removing DLC.' }
  const root = resolve(dlcRoot())
  const path = resolve(root, fileName)
  if (!path.startsWith(root + sep) || !existsSync(path)) {
    return { ok: false, error: 'DLC package not found.' }
  }

  const header = await readHeader(path).catch(() => null)
  const installed = header?.valid ? await installedPaths(basename(path), header.titleId) : []
  // Recycle bin rather than a hard delete: DLC packages are not re-downloadable.
  for (const target of [path, ...installed]) await shell.trashItem(target)
  return { ok: true }
}
