import { app } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Result, SaveBackup } from '@shared/types'
import { exeDir, isDirectory, isRunning, userRoot } from './game'

// Save data layout (rexglue content_manager.cpp), relative to the user root:
//   <XUID16>/<TITLE8>/00000001/...   saved games, one folder per profile
//   <TITLE8>/profile/<XUID16>        per-profile game data
//   profiles/profiles.toml           local profiles
// XUID 0 holds installed DLC, which is not save data. A "saves" folder beside
// the executable replaces the per-profile saved-game folders.

const XUID_DIR = /^[0-9A-F]{16}$/i
const TITLE_DIR = /^[0-9A-F]{8}$/i
const DLC_XUID = '0000000000000000'
const PORTABLE_SAVES = 'saves'
const BACKUP_ID = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?$/

export const backupsRoot = (): string => join(app.getPath('userData'), 'backups')

interface BackupMeta {
  createdAt: number
  note: string
}

/** Names inside a backup's data folder map back to these live locations. */
function liveTarget(name: string): string | null {
  if (name === PORTABLE_SAVES) {
    const dir = exeDir()
    return dir ? join(dir, PORTABLE_SAVES) : null
  }
  return join(userRoot(), name)
}

async function saveEntries(): Promise<string[]> {
  const root = userRoot()
  const entries: string[] = []
  const dir = exeDir()
  if (dir && isDirectory(join(dir, PORTABLE_SAVES))) entries.push(PORTABLE_SAVES)

  let names: string[] = []
  try {
    names = await readdir(root)
  } catch {
    // No user data folder yet.
  }
  for (const name of names) {
    const isSaveDir =
      (XUID_DIR.test(name) && name !== DLC_XUID) || TITLE_DIR.test(name) || name === 'profiles'
    if (isSaveDir && isDirectory(join(root, name)) && !entries.includes(name)) entries.push(name)
    if (name === 'settings.toml') entries.push(name)
  }
  return entries
}

async function measure(path: string): Promise<{ bytes: number; files: number }> {
  const info = await stat(path)
  if (!info.isDirectory()) return { bytes: info.size, files: 1 }
  let bytes = 0
  let files = 0
  for (const name of await readdir(path)) {
    const inner = await measure(join(path, name))
    bytes += inner.bytes
    files += inner.files
  }
  return { bytes, files }
}

function newBackupId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  let id = stamp
  for (let n = 2; existsSync(join(backupsRoot(), id)); n++) id = `${stamp}-${n}`
  return id
}

export async function listBackups(): Promise<SaveBackup[]> {
  let ids: string[] = []
  try {
    ids = await readdir(backupsRoot())
  } catch {
    return []
  }
  const backups: SaveBackup[] = []
  for (const id of ids) {
    if (!BACKUP_ID.test(id)) continue
    try {
      const dir = join(backupsRoot(), id)
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as BackupMeta
      const { bytes, files } = await measure(join(dir, 'data'))
      backups.push({ id, createdAt: meta.createdAt, note: meta.note, sizeBytes: bytes, fileCount: files })
    } catch {
      // Skip folders that are not complete backups.
    }
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createBackup(note: string): Promise<Result> {
  const entries = await saveEntries()
  if (!entries.some((name) => name !== 'settings.toml')) {
    return { ok: false, error: 'No save data found yet. Play the game first.' }
  }
  const dir = join(backupsRoot(), newBackupId())
  const data = join(dir, 'data')
  await mkdir(data, { recursive: true })
  try {
    for (const name of entries) {
      const source = liveTarget(name)
      if (source) await cp(source, join(data, name), { recursive: true })
    }
    const meta: BackupMeta = { createdAt: Date.now(), note: note.trim().slice(0, 80) }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return { ok: true }
}

export async function restoreBackup(id: string): Promise<Result> {
  if (isRunning()) return { ok: false, error: 'Close Skate 3 before restoring saves.' }
  const data = join(backupsRoot(), id, 'data')
  if (!BACKUP_ID.test(id) || !isDirectory(data)) return { ok: false, error: 'Backup not found.' }

  const names = await readdir(data)
  const targets = names.map((name) => ({ name, target: liveTarget(name) }))
  if (targets.some((entry) => !entry.target)) {
    return {
      ok: false,
      error: 'This backup holds portable saves. Locate the Skate 3 executable first.'
    }
  }

  // Keep whatever is about to be replaced; nothing to keep is not a failure.
  if ((await saveEntries()).some((name) => name !== 'settings.toml')) {
    await createBackup('Automatic backup before restore')
  }
  for (const { name, target } of targets) {
    await rm(target!, { recursive: true, force: true })
    await cp(join(data, name), target!, { recursive: true })
  }
  return { ok: true }
}

export async function deleteBackup(id: string): Promise<Result> {
  if (!BACKUP_ID.test(id)) return { ok: false, error: 'Backup not found.' }
  await rm(join(backupsRoot(), id), { recursive: true, force: true })
  return { ok: true }
}
