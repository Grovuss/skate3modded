import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ModConflict, ModInfo, Result } from '@shared/types'
import { openBig, patchBig, readEntry } from './big'
import { decodePng, replaceTextures, type Image } from './textureEncode'
import { exeDir, gameRoot, isDirectory, isGameInstalled, isRunning } from './game'
import { extractZip } from './zip'

// Mods are file replacements for the installed game data (<exe dir>/game). A mod file either replaces
// a whole game file, or — placed in a folder named like a .big archive — one entry inside that archive;
// the launcher then rebuilds the archive from the original plus every enabled mod's entries.
//
// Library (per user):    <userData>/mods/<id>/mod.json + files/<path under game>
// Install state (per game install, beside the executable):
//   .skate3cubed/mods.json     priority order, enabled mods, files applied
//   .skate3cubed/originals/    game files moved aside while a mod replaces them
//
// Enabling a mod moves each original aside and copies the mod's file in;
// disabling puts the original back. When two enabled mods replace the same
// file, the one higher in the list wins.

interface ModMeta {
  id: string
  name: string
  version: string
  author: string
  description: string
  addedAt: number
  sizeBytes: number
  /** Paths relative to the game data root, forward slashes. */
  files: string[]
}

interface AppliedFile {
  mod: string
  /** Path as written into the game folder. */
  path: string
  /** False when the mod added a file the game did not have. */
  hadOriginal: boolean
  /** What the file was built from (see signatureOf); absent in states written before archive patching. */
  signature?: string
}

interface InstallState {
  /** Mod ids, highest priority first. */
  order: string[]
  enabled: string[]
  /** Keyed by lower-cased path: Windows file names are case-insensitive. */
  applied: Record<string, AppliedFile>
}

const MANIFEST = 'mod.json'
const STATE_DIR = '.skate3cubed'
/** Loose files beside a mod's content that are documentation, not game data. */
const DOC_FILE = /\.(txt|md|nfo|url|png|jpe?g)$/i
const MOD_ID = /^[a-z0-9-]+$/

export const libraryRoot = (): string => join(app.getPath('userData'), 'mods')
const modDir = (id: string): string => join(libraryRoot(), id)

const statePath = (): string | null => {
  const dir = exeDir()
  return dir ? join(dir, STATE_DIR, 'mods.json') : null
}
const originalsRoot = (): string => join(exeDir()!, STATE_DIR, 'originals')

// Every operation reads and rewrites the state file, so they run one at a time.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation)
  queue = run.catch(() => undefined)
  return run
}

async function loadMetas(): Promise<Map<string, ModMeta>> {
  const metas = new Map<string, ModMeta>()
  let ids: string[] = []
  try {
    ids = await readdir(libraryRoot())
  } catch {
    return metas
  }
  for (const id of ids) {
    if (!MOD_ID.test(id)) continue
    try {
      metas.set(id, JSON.parse(await readFile(join(modDir(id), MANIFEST), 'utf8')) as ModMeta)
    } catch {
      // Not a complete mod (e.g. an interrupted import).
    }
  }
  return metas
}

async function loadState(metas: Map<string, ModMeta>): Promise<InstallState> {
  let state: InstallState = { order: [], enabled: [], applied: {} }
  const path = statePath()
  if (path) {
    try {
      state = { ...state, ...(JSON.parse(await readFile(path, 'utf8')) as Partial<InstallState>) }
    } catch {
      // No mods used with this install yet.
    }
  }
  // Newly imported mods join the bottom of the list; removed ones drop out.
  const known = state.order.filter((id) => metas.has(id))
  const added = [...metas.values()]
    .filter((meta) => !known.includes(meta.id))
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((meta) => meta.id)
  state.order = [...known, ...added]
  state.enabled = state.enabled.filter((id) => metas.has(id))
  return state
}

async function saveState(state: InstallState): Promise<void> {
  const path = statePath()
  if (!path) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2))
}

/**
 * A mod file inside a folder named like an archive ("…/createacharacter.big/<path inside>") replaces
 * or adds that one entry of the archive instead of a whole game file.
 */
export function splitArchivePath(path: string): { archive: string; entry: string } | null {
  const parts = path.split('/')
  const at = parts.findIndex((part, i) => i < parts.length - 1 && /\.big$/i.test(part))
  if (at < 0) return null
  return { archive: parts.slice(0, at + 1).join('/'), entry: parts.slice(at + 1).join('/') }
}

/**
 * An image named like a texture file plus ".png" ("x.rx2.png", or "x.rx2_3.png" for the fourth
 * texture of a file holding several) replaces that texture; this is how extraction names them.
 */
function splitTextureImage(entry: string): { entry: string; texture: number } | null {
  const match = /^(.*\.rx2)(?:_(\d+))?\.png$/i.exec(entry)
  return match ? { entry: match[1], texture: Number(match[2] ?? 0) } : null
}

interface Source {
  mod: string
  file: string
}

interface WantedEntry {
  /** Path inside the archive. */
  entry: string
  /** Replacement for the whole entry, if a mod provides one. */
  file: Source | null
  /** Replacement images by texture number, applied to the entry. */
  images: Map<number, Source>
}

interface Wanted {
  path: string
  /** Mod replacing the whole file, if any. */
  whole: string | null
  /** Archive entries to replace or add, keyed by lower-cased entry path. */
  entries: Map<string, WantedEntry>
}

/** Identifies what a target file was built from, so unchanged files are left alone. */
function signatureOf(wanted: Wanted): string {
  if (wanted.entries.size === 0) return wanted.whole!
  const hash = createHash('sha1').update(wanted.whole ?? '')
  for (const key of [...wanted.entries.keys()].sort()) {
    const { file, images } = wanted.entries.get(key)!
    hash.update(`\n${key}=${file?.mod ?? ''}`)
    for (const number of [...images.keys()].sort((a, b) => a - b)) hash.update(`,${number}:${images.get(number)!.mod}`)
  }
  return `patched:${hash.digest('hex')}`
}

/** Works out the new contents of each changed entry of an archive. */
async function buildEntries(base: string, wanted: Wanted, notes: string[]): Promise<Map<string, Buffer>> {
  const changes = new Map<string, Buffer>()
  const archive = [...wanted.entries.values()].some((item) => item.images.size && !item.file)
    ? await openBig(base)
    : null
  for (const { entry, file, images } of wanted.entries.values()) {
    let contents: Buffer
    if (file) contents = await readFile(file.file)
    else {
      const original = archive?.entries.find((other) => other.path.toLowerCase() === entry.toLowerCase())
      if (!original) throw new Error(`A mod has an image for ${entry}, which is not in ${wanted.path}.`)
      contents = await readEntry(base, original)
    }
    if (images.size) {
      const decoded = new Map<number, Image>()
      for (const [number, source] of images) decoded.set(number, decodePng(await readFile(source.file)))
      try {
        const replaced = replaceTextures(contents, decoded)
        contents = replaced.arena
        notes.push(...replaced.notes.map((note) => `${entry.split('/').pop()}: ${note}.`))
      } catch (error) {
        throw new Error(`${entry}: ${error instanceof Error ? error.message : String(error)}.`)
      }
    }
    changes.set(entry, contents)
  }
  return changes
}

/** The unmodded copy of a game file: the one set aside while a mod replaces it, else the file itself. */
export function pristinePath(path: string): string {
  const original = join(originalsRoot(), path)
  return existsSync(original) ? original : join(gameRoot()!, path)
}

/**
 * Makes the game folder match the enabled mods, touching only files that change. Returns notes about
 * anything that was applied only in part.
 */
async function sync(state: InstallState, metas: Map<string, ModMeta>): Promise<string[]> {
  const notes: string[] = []
  const root = gameRoot()!
  const desired = new Map<string, Wanted>()
  for (const id of state.order) {
    if (!state.enabled.includes(id)) continue
    for (const path of metas.get(id)?.files ?? []) {
      const inArchive = splitArchivePath(path)
      const targetPath = inArchive?.archive ?? path
      const key = targetPath.toLowerCase()
      let wanted = desired.get(key)
      if (!wanted) desired.set(key, (wanted = { path: targetPath, whole: null, entries: new Map() }))
      // Mods are visited highest priority first: the first claim on a file or entry stands.
      if (!inArchive) {
        wanted.whole ??= id
        continue
      }
      // Extraction writes entries of archives without file names as "unnamed/<hash>".
      const named = inArchive.entry.replace(/^unnamed\//i, '#')
      const image = splitTextureImage(named)
      const entry = image?.entry ?? named
      let item = wanted.entries.get(entry.toLowerCase())
      if (!item) wanted.entries.set(entry.toLowerCase(), (item = { entry, file: null, images: new Map() }))
      const source = { mod: id, file: join(modDir(id), 'files', path) }
      if (!image) item.file ??= source
      // An image only applies on top of a file from the same or a lower-priority mod.
      else if (!item.images.has(image.texture) && (!item.file || item.file.mod === id)) {
        item.images.set(image.texture, source)
      }
    }
  }

  try {
    for (const [key, applied] of Object.entries(state.applied)) {
      if (desired.has(key)) continue
      const target = join(root, applied.path)
      const original = join(originalsRoot(), applied.path)
      await rm(target, { force: true })
      if (applied.hadOriginal && existsSync(original)) await rename(original, target)
      delete state.applied[key]
    }

    for (const [key, wanted] of desired) {
      const current = state.applied[key]
      const signature = signatureOf(wanted)
      if (current && (current.signature ?? current.mod) === signature) continue
      const path = current?.path ?? wanted.path
      const target = join(root, path)
      const original = join(originalsRoot(), path)
      let hadOriginal = current?.hadOriginal ?? false
      if (!current && existsSync(target)) {
        await mkdir(dirname(original), { recursive: true })
        // An original already set aside is the real one: never overwrite it.
        if (existsSync(original)) await rm(target, { force: true })
        else await rename(target, original)
        hadOriginal = true
      }
      await mkdir(dirname(target), { recursive: true })
      const base = wanted.whole ? join(modDir(wanted.whole), 'files', wanted.path) : original
      if (wanted.entries.size === 0) {
        await copyFile(base, target)
      } else {
        if (!wanted.whole && !hadOriginal) {
          throw new Error(`A mod changes files inside ${wanted.path}, which this game install does not have.`)
        }
        const changes = await buildEntries(base, wanted, notes)
        await rm(target, { force: true })
        await patchBig(base, target, changes)
      }
      state.applied[key] = { mod: wanted.whole ?? 'patched', path, hadOriginal, signature }
    }
  } finally {
    // Record what was actually done, even if a file operation failed part-way.
    await saveState(state)
  }
  return notes
}

function conflictsFor(
  id: string,
  state: InstallState,
  metas: Map<string, ModMeta>
): ModConflict[] {
  if (!state.enabled.includes(id)) return []
  const own = new Set(metas.get(id)!.files.map((path) => path.toLowerCase()))
  const conflicts: ModConflict[] = []
  for (const other of state.enabled) {
    if (other === id) continue
    const shared = metas.get(other)!.files.filter((path) => own.has(path.toLowerCase())).length
    if (shared > 0) {
      conflicts.push({
        name: metas.get(other)!.name,
        fileCount: shared,
        wins: state.order.indexOf(id) < state.order.indexOf(other)
      })
    }
  }
  return conflicts
}

/** True while any mod's files are in the game folder. */
export function hasAppliedMods(): Promise<boolean> {
  return enqueue(async () => {
    const state = await loadState(await loadMetas())
    return Object.keys(state.applied).length > 0
  })
}

export function listMods(): Promise<ModInfo[]> {
  return enqueue(async () => {
    const metas = await loadMetas()
    const state = await loadState(metas)
    return state.order.map((id) => {
      const meta = metas.get(id)!
      return {
        id,
        name: meta.name,
        version: meta.version,
        author: meta.author,
        description: meta.description,
        fileCount: meta.files.length,
        sizeBytes: meta.sizeBytes,
        enabled: state.enabled.includes(id),
        conflicts: conflictsFor(id, state, metas)
      }
    })
  })
}

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await walk(join(dir, entry.name), relative)))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

/** Breadth-first search for a directory entry by name, a few levels deep. */
async function findShallowest(
  root: string,
  name: string,
  wantDirectory: boolean
): Promise<string | null> {
  let level = [root]
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: string[] = []
    for (const dir of level) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === name && entry.isDirectory() === wantDirectory) {
          return join(dir, entry.name)
        }
        if (entry.isDirectory()) next.push(join(dir, entry.name))
      }
    }
    level = next
  }
  return null
}

/**
 * Finds the folder inside a mod that lines up with the game data root. With a
 * mod.json: its "files" folder, or the folder holding it. Otherwise the folder
 * that contains the game's top-level "data" folder, or failing that the mod's
 * own root with any single wrapper folder removed.
 */
async function locateContent(source: string): Promise<{ root: string; manifest: string | null }> {
  const manifest = await findShallowest(source, MANIFEST, false)
  if (manifest) {
    const packaged = join(dirname(manifest), 'files')
    return { root: isDirectory(packaged) ? packaged : dirname(manifest), manifest }
  }
  const data = await findShallowest(source, 'data', true)
  if (data) return { root: dirname(data), manifest: null }

  let root = source
  for (;;) {
    const entries = await readdir(root, { withFileTypes: true })
    if (entries.length !== 1 || !entries[0].isDirectory()) break
    root = join(root, entries[0].name)
  }
  return { root, manifest: null }
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim().slice(0, 300) : fallback

async function importFolder(source: string, fallbackName: string): Promise<Result> {
  const { root, manifest } = await locateContent(source)
  const files = (await walk(root)).filter(
    (path) => path !== MANIFEST && (path.includes('/') || !DOC_FILE.test(path))
  )
  if (files.length === 0) return { ok: false, error: 'No mod files were found in that selection.' }

  let declared: Record<string, unknown> = {}
  if (manifest) {
    try {
      // Windows editors often save JSON with a byte-order mark, which JSON.parse rejects.
      const json = (await readFile(manifest, 'utf8')).replace(/^﻿/, '')
      declared = JSON.parse(json) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'The mod.json in this mod is not valid JSON.' }
    }
  }
  const name = text(declared.name) || fallbackName
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const id = `${slug || 'mod'}-${randomBytes(3).toString('hex')}`

  const dest = modDir(id)
  let sizeBytes = 0
  try {
    for (const path of files) {
      const target = join(dest, 'files', path)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(root, path), target)
      sizeBytes += (await stat(target)).size
    }
    const meta: ModMeta = {
      id,
      name,
      version: text(declared.version),
      author: text(declared.author),
      description: text(declared.description),
      addedAt: Date.now(),
      sizeBytes,
      files
    }
    // Written last: a folder without it is ignored as an incomplete import.
    await writeFile(join(dest, MANIFEST), JSON.stringify(meta, null, 2))
  } catch (error) {
    await rm(dest, { recursive: true, force: true })
    throw error
  }
  return { ok: true }
}

export function importMod(source: string): Promise<Result> {
  return enqueue(async () => {
    const name = basename(source, extname(source))
    if (isDirectory(source)) return importFolder(source, basename(source))

    const unpacked = join(libraryRoot(), `.import-${randomBytes(4).toString('hex')}`)
    try {
      await extractZip(source, unpacked)
      return await importFolder(unpacked, name)
    } finally {
      await rm(unpacked, { recursive: true, force: true })
    }
  })
}

/** Loads state, applies a change to it, then brings the game folder in line. */
function change(
  id: string,
  mutate: (state: InstallState) => void,
  after?: () => Promise<void>
): Promise<Result> {
  return enqueue(async () => {
    const metas = await loadMetas()
    if (!metas.has(id)) return { ok: false, error: 'Mod not found.' }
    const state = await loadState(metas)
    mutate(state)

    const touchesGame = state.enabled.length > 0 || Object.keys(state.applied).length > 0
    if (touchesGame) {
      if (isRunning()) return { ok: false, error: 'Close Skate 3 before changing mods.' }
      if (!isGameInstalled()) {
        return { ok: false, error: 'Install the game files first: press Play and select your ISO.' }
      }
      let notes: string[]
      try {
        notes = await sync(state, metas)
      } catch (error) {
        // A mod that cannot be applied (say, an image of the wrong size) must not stay switched on:
        // it would fail again on every later change. Switch it off and put the game files right.
        if (!state.enabled.includes(id)) throw error
        state.enabled = state.enabled.filter((other) => other !== id)
        await sync(state, metas).catch(() => undefined)
        const reason = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `${metas.get(id)!.name} could not be applied and was switched off. ${reason}` }
      }
      await after?.()
      return notes.length ? { ok: true, warning: notes.join(' ') } : { ok: true }
    }
    await saveState(state)
    await after?.()
    return { ok: true }
  })
}

export function setModEnabled(id: string, enabled: boolean): Promise<Result> {
  return change(id, (state) => {
    state.enabled = state.enabled.filter((other) => other !== id)
    if (enabled) state.enabled.push(id)
  })
}

export function moveMod(id: string, delta: number): Promise<Result> {
  return change(id, (state) => {
    const from = state.order.indexOf(id)
    const to = Math.max(0, Math.min(state.order.length - 1, from + Math.sign(delta)))
    state.order.splice(from, 1)
    state.order.splice(to, 0, id)
  })
}

export function removeMod(id: string): Promise<Result> {
  return change(
    id,
    (state) => {
      state.enabled = state.enabled.filter((other) => other !== id)
      state.order = state.order.filter((other) => other !== id)
    },
    () => rm(modDir(id), { recursive: true, force: true })
  )
}
