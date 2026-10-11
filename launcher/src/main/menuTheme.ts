import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Result } from '@shared/types'
import { exeDir, isRunning, updateConfig } from './game'

// Recolours the game build's own settings menu and overlays (FPS counter, debug windows) to the
// launcher's palette. Their colours are constants compiled into rexruntime.dll, so this replaces
// those constants in the file and keeps the original beside it. Every constant must occur exactly
// as often as it does in the build this was made for (2.0.2); otherwise nothing is touched.

type Rgba = [number, number, number, number]

/** Settings menu (rexglue simple_settings_overlay.cpp): [original, occurrences, replacement]. */
const MENU: [Rgba, number, Rgba][] = [
  [[14, 56, 53, 140], 3, [20, 26, 42, 205]], // category panels
  [[24, 90, 86, 166], 2, [34, 44, 72, 220]], // category panel, hovered
  [[11, 46, 43, 140], 2, [17, 20, 27, 205]], // description panel
  [[213, 235, 10, 255], 7, [47, 98, 245, 255]], // accent
  [[13, 15, 5, 255], 3, [244, 246, 252, 255]], // text on the accent
  [[230, 0, 120, 255], 6, [47, 98, 245, 255]], // arrows and sliders
  [[255, 25, 145, 255], 2, [90, 132, 255, 255]], // arrows and sliders, hovered
  [[235, 242, 241, 255], 6, [233, 236, 243, 255]], // text
  [[224, 235, 234, 191], 3, [200, 207, 222, 200]], // dim text
  [[233, 88, 76, 255], 4, [240, 85, 106, 255]], // danger
  [[245, 197, 87, 255], 4, [242, 184, 75, 255]], // warning
  [[6, 9, 11, 133], 1, [10, 12, 17, 160]] // backdrop
]

/** The green overlay style (rexglue imgui_drawer.cpp), as float colours. */
const STYLE: Rgba[] = [
  [0, 0.06, 0, 1],
  [0, 0.35, 0, 1],
  [0, 0.4, 0, 1],
  [0, 0.33, 0, 1],
  [0.16, 0.65, 0, 1],
  [0, 0.4, 0.11, 0.59],
  [0, 0.68, 0, 0.68],
  [0, 1, 0.15, 0.62],
  [0, 0.91, 0.09, 0.4],
  [0.74, 0.9, 0.72, 0.5],
  [0.34, 0.75, 0.11, 1],
  [0.15, 0.56, 0.11, 0.6],
  [0.19, 0.72, 0.09, 1],
  [0.19, 0.6, 0.09, 1],
  [0, 0.4, 0, 0.71],
  [0, 0.6, 0.26, 0.8],
  [0, 0.75, 0, 0.8],
  [0.36, 0.89, 0.38, 1],
  [0.13, 0.5, 0.11, 1],
  [0, 1, 0, 0.21]
]
/** Window background and border get the launcher's own values. */
const STYLE_FIXED = new Map<string, Rgba>([
  ['0,0.06,0,1', [0.039, 0.047, 0.067, 1]],
  ['0,0.35,0,1', [0.133, 0.153, 0.204, 1]]
])

/** Moves a green towards the launcher's blue (#2f62f5), keeping how strong and bright it was. */
function blueOf([r, g, b, a]: Rgba): Rgba {
  const fixed = STYLE_FIXED.get([r, g, b, a].join())
  if (fixed) return fixed
  const amount = g - Math.max(r, b)
  return [
    Math.min(1, r + amount * 0.18),
    Math.min(1, g - amount + amount * 0.38),
    Math.min(1, b + amount * 0.96),
    a
  ]
}

const floats = (colour: Rgba): Buffer => {
  const bytes = Buffer.alloc(16)
  colour.forEach((value, i) => bytes.writeFloatLE(value, i * 4))
  return bytes
}

function positions(file: Buffer, needle: Buffer): number[] {
  const found: number[] = []
  for (let p = 0; (p = file.indexOf(needle, p)) >= 0; p++) found.push(p)
  return found
}

/** The themed version of an original library, or null when it is not the build this was made for. */
function themed(original: Buffer): Buffer | null {
  const out = Buffer.from(original)
  const swaps: [Buffer, number, Buffer][] = [
    ...MENU.map(([from, count, to]): [Buffer, number, Buffer] => [Buffer.from(from), count, Buffer.from(to)]),
    ...STYLE.map((colour): [Buffer, number, Buffer] => [floats(colour), 1, floats(blueOf(colour))])
  ]
  for (const [from, count, to] of swaps) {
    const at = positions(original, from)
    if (at.length !== count) return null
    for (const p of at) to.copy(out, p)
  }
  return out
}

const libraryPath = (): string | null => {
  const dir = exeDir()
  return dir ? join(dir, 'rexruntime.dll') : null
}
const backupPath = (): string => join(exeDir()!, '.skate3cubed', 'rexruntime.dll.original')

async function apply(): Promise<Result> {
  const library = libraryPath()
  if (!library || !existsSync(library)) return { ok: false, error: 'The game build is not installed.' }
  const current = await readFile(library)
  if (existsSync(backupPath())) {
    const expected = themed(await readFile(backupPath()))
    if (expected?.equals(current)) return { ok: true }
    // The library is not the one that was themed: a game update replaced it. Start over from it.
  }
  const result = themed(current)
  if (!result) {
    return { ok: false, error: 'The colours of this game build cannot be changed: it differs from the build the theme was made for.' }
  }
  await mkdir(join(exeDir()!, '.skate3cubed'), { recursive: true })
  await copyFile(library, backupPath())
  await writeFile(library, result)
  return { ok: true }
}

async function restore(): Promise<Result> {
  const library = libraryPath()
  if (!library || !existsSync(backupPath())) return { ok: true }
  // Only put the original back over the file made from it; a newer library is left alone.
  const expected = themed(await readFile(backupPath()))
  if (existsSync(library) && expected?.equals(await readFile(library))) await copyFile(backupPath(), library)
  await rm(backupPath(), { force: true })
  return { ok: true }
}

export async function setMenuTheme(on: boolean): Promise<Result> {
  if (isRunning()) return { ok: false, error: 'Close Skate 3 first.' }
  const result = on ? await apply() : await restore()
  if (result.ok) await updateConfig({ menuTheme: on })
  return result
}

/** After the game build is installed or updated: theme the new library if the option is on. */
export async function reapplyMenuTheme(wanted: boolean): Promise<void> {
  if (wanted) await apply().catch(() => undefined)
}
