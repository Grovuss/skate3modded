import { app } from 'electron'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ArchiveEntryInfo, ArchiveInfo, ExtractResult } from '@shared/types'
import { openBig, readEntry } from './big'
import { gameRoot } from './game'
import { STRINGS_SUFFIX, pristinePath } from './mods'
import { exportStrings, isTextTable } from './textTable'
import { decodeTextures, encodePng } from './texture'

// Tools for mod authors: look inside the game's archives and pull files out of them.
// Everything reads the unmodded copy of an archive, so extracted files are always the originals.

export const extractedRoot = (): string => join(app.getPath('userData'), 'extracted')

async function findArchives(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await findArchives(join(dir, entry.name), relative)))
    else if (/\.big$/i.test(entry.name)) found.push(relative)
  }
  return found
}

export async function listArchives(): Promise<ArchiveInfo[]> {
  const root = gameRoot()
  if (!root) return []
  const archives: ArchiveInfo[] = []
  for (const path of (await findArchives(root).catch(() => [])).sort()) {
    const file = pristinePath(path)
    const archive = await openBig(file).catch(() => null)
    if (!archive) continue
    archives.push({ path, sizeBytes: (await stat(file)).size, entryCount: archive.entries.length })
  }
  return archives
}

/** Rejects anything that is not one of the game's own archives. */
function archiveFile(path: string): string {
  if (!gameRoot() || !/\.big$/i.test(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error('Unknown archive.')
  }
  return pristinePath(path)
}

export async function listEntries(path: string): Promise<ArchiveEntryInfo[]> {
  const archive = await openBig(archiveFile(path))
  if (!archive) throw new Error('Not a Skate 3 archive.')
  // The archive keeps its index in hash order; by path is what a person can read.
  return archive.entries
    .map((entry) => ({ path: entry.path, sizeBytes: entry.size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Writes entries of an archive to <user data>/extracted/<archive>/<entry path>; the layout matches
 * what a mod's "files" folder expects. With `png`, textures are also saved as images beside them.
 */
export async function extractEntries(
  path: string,
  entries: string[],
  png: boolean
): Promise<ExtractResult> {
  const file = archiveFile(path)
  const archive = await openBig(file)
  if (!archive) throw new Error('Not a Skate 3 archive.')
  const wanted = new Set(entries)
  const folder = join(extractedRoot(), ...path.split('/'))
  let files = 0
  let images = 0
  let texts = 0
  let failed = 0
  // Text tables are listed with their labels, which the archive keeps in a table of their own.
  const labelTables = new Map<string, Buffer | null>()
  const labelsFor = async (tablePath: string): Promise<Buffer | null> => {
    const labelsPath = tablePath.replace(/LANGUAGE_[^_/]+_/i, 'LANGUAGE_Labels_').toLowerCase()
    if (!labelTables.has(labelsPath)) {
      const found = archive.entries.find((other) => other.path.toLowerCase() === labelsPath)
      labelTables.set(labelsPath, found ? await readEntry(file, found).catch(() => null) : null)
    }
    return labelTables.get(labelsPath)!
  }
  for (const entry of archive.entries) {
    if (!wanted.has(entry.path)) continue
    // Entry paths come from the archive: keep them inside the output folder.
    const parts = entry.path.replace(/^#/, 'unnamed/').split('/').filter((part) => part && part !== '..')
    const target = join(folder, ...parts)
    try {
      const contents = await readEntry(file, entry)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents)
      files++
      if (isTextTable(contents)) {
        const strings = exportStrings(contents, await labelsFor(entry.path))
        await writeFile(`${target}${STRINGS_SUFFIX}`, JSON.stringify(strings, null, 2))
        texts++
      }
      if (png) {
        const textures = decodeTextures(contents)
        for (const [index, texture] of textures.entries()) {
          if (!texture.rgba) continue
          const suffix = textures.length > 1 ? `_${index}` : ''
          await writeFile(`${target}${suffix}.png`, encodePng(texture.width, texture.height, texture.rgba))
          images++
        }
      }
    } catch {
      failed++
    }
  }
  return { ok: true, folder, files, images, texts, failed }
}
