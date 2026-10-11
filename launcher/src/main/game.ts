import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  AfterLaunch,
  GameStatus,
  LauncherConfig,
  LauncherOptions,
  Result,
  SettingValues
} from '@shared/types'
import { SETTING_TYPES } from '@shared/settingsSchema'
import { formatValue, parseFlatToml, updateFlatToml } from './toml'

export const EXE_NAME = process.platform === 'win32' ? 'skate3.exe' : 'skate3'

/** A game that exits this soon with an error code never really started. */
const FAILED_START_MS = 5000

/** A folder named this, beside the launcher or up to a few levels above it, is searched for an ISO. */
const ISO_FOLDER = 'GameISO'

const AFTER_LAUNCH: readonly AfterLaunch[] = ['keep', 'minimize', 'close']

let config: LauncherConfig = {
  exePath: null,
  extraArgs: '',
  managedVersion: null,
  isoPath: null,
  afterLaunch: 'keep',
  checkUpdates: true
}
let child: ChildProcess | null = null
let statusListener: (() => void) | null = null
let noticeListener: ((message: string) => void) | null = null

const configPath = (): string => join(app.getPath('userData'), 'config.json')

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Where the launcher installs the build it manages. The game extracts several
 * gigabytes beside its executable, so on Windows this is the local (non-roaming)
 * app data folder.
 */
export function managedDir(): string {
  const base = (process.platform === 'win32' && process.env.LOCALAPPDATA) || app.getPath('appData')
  return join(base, 'Skate3Cubed', 'game')
}

export const managedExe = (): string => join(managedDir(), EXE_NAME)

function detectExecutable(): string | null {
  const roots = [managedDir(), dirname(app.getPath('exe')), process.cwd()]
  for (const root of roots) {
    for (const candidate of [join(root, EXE_NAME), join(root, 'game', EXE_NAME)]) {
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

export async function loadConfig(): Promise<void> {
  try {
    const stored = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<LauncherConfig>
    config = {
      exePath: typeof stored.exePath === 'string' ? stored.exePath : null,
      extraArgs: typeof stored.extraArgs === 'string' ? stored.extraArgs : '',
      managedVersion: typeof stored.managedVersion === 'string' ? stored.managedVersion : null,
      isoPath: typeof stored.isoPath === 'string' ? stored.isoPath : null,
      afterLaunch: AFTER_LAUNCH.includes(stored.afterLaunch!) ? stored.afterLaunch! : 'keep',
      checkUpdates: stored.checkUpdates !== false
    }
  } catch {
    // First run, or an unreadable config: start from defaults.
  }
  if (!config.exePath || !isFile(config.exePath)) {
    config.exePath = detectExecutable() ?? config.exePath
  }
}

export async function updateConfig(changes: Partial<LauncherConfig>): Promise<void> {
  config = { ...config, ...changes }
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(configPath(), JSON.stringify(config, null, 2))
  statusListener?.()
}

/** Applies launcher preferences from the UI, ignoring anything malformed. */
export async function setLauncherOptions(options: LauncherOptions): Promise<void> {
  const changes: LauncherOptions = {}
  if (AFTER_LAUNCH.includes(options.afterLaunch!)) changes.afterLaunch = options.afterLaunch
  if (typeof options.checkUpdates === 'boolean') changes.checkUpdates = options.checkUpdates
  await updateConfig(changes)
}

export const exeDir = (): string | null => (config.exePath ? dirname(config.exePath) : null)

export const gameRoot = (): string | null => {
  const dir = exeDir()
  return dir ? join(dir, 'game') : null
}

export const isGameInstalled = (): boolean => {
  const root = gameRoot()
  return !!root && isFile(join(root, 'default.xex'))
}

/** The ISO to install game files from: the one the user chose, else one in a GameISO folder. */
export function findIso(): string | null {
  if (config.isoPath && isFile(config.isoPath)) return config.isoPath
  for (const start of [dirname(app.getPath('exe')), app.getAppPath(), process.cwd()]) {
    let dir = start
    for (let depth = 0; depth < 4; depth++) {
      try {
        const name = readdirSync(join(dir, ISO_FOLDER)).find((file) => /\.iso$/i.test(file))
        if (name) return join(dir, ISO_FOLDER, name)
      } catch {
        // No GameISO folder here.
      }
      if (dirname(dir) === dir) break
      dir = dirname(dir)
    }
  }
  return null
}

/** Mirrors ResolveSkate3UserRoot in src/skate3_app_common.cpp. */
export function userRoot(): string {
  const dir = exeDir()
  if (dir && existsSync(join(dir, 'portable.txt'))) return dir
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'skate3')
  }
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'skate3')
}

export const isRunning = (): boolean => child !== null

const isManaged = (): boolean =>
  !!config.exePath && resolve(config.exePath).toLowerCase() === resolve(managedExe()).toLowerCase()

export function getStatus(): GameStatus {
  const dir = exeDir()
  return {
    platform: process.platform,
    exePath: config.exePath,
    exeFound: !!config.exePath && isFile(config.exePath),
    managed: isManaged(),
    installedVersion: isManaged() ? config.managedVersion : null,
    gameRoot: gameRoot(),
    gameInstalled: isGameInstalled(),
    isoPath: findIso(),
    userRoot: userRoot(),
    portable: !!dir && existsSync(join(dir, 'portable.txt')),
    portableSaves: !!dir && isDirectory(join(dir, 'saves')),
    running: isRunning(),
    extraArgs: config.extraArgs,
    afterLaunch: config.afterLaunch,
    checkUpdates: config.checkUpdates
  }
}

export function onStatusChanged(listener: () => void): void {
  statusListener = listener
}

export const notifyStatusChanged = (): void => statusListener?.()

export function onNotice(listener: (message: string) => void): void {
  noticeListener = listener
}

function splitArgs(text: string): string[] {
  const args: string[] = []
  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    args.push(match[1] ?? match[2])
  }
  return args
}

export function launch(): Result {
  if (child) return { ok: false, error: 'Skate 3 is already running.' }
  const exePath = config.exePath
  if (!exePath || !isFile(exePath)) {
    return { ok: false, error: 'The Skate 3 executable could not be found.' }
  }

  const startedAt = Date.now()
  const spawned = spawn(exePath, splitArgs(config.extraArgs), {
    cwd: dirname(exePath),
    detached: true,
    stdio: 'ignore'
  })
  child = spawned
  const clear = (): void => {
    if (child === spawned) {
      child = null
      statusListener?.()
    }
  }
  spawned.once('error', (error) => {
    clear()
    noticeListener?.(`Skate 3 could not be started: ${error.message}`)
  })
  spawned.once('exit', (code) => {
    clear()
    if (code && Date.now() - startedAt < FAILED_START_MS) {
      noticeListener?.(`Skate 3 closed right after starting (exit code ${code}).`)
    }
  })
  spawned.unref()
  statusListener?.()
  return { ok: true }
}

const settingsPath = (): string => join(userRoot(), 'settings.toml')

export async function readSettings(): Promise<SettingValues> {
  try {
    return parseFlatToml(await readFile(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

// Each write is a read-modify-write of the whole file, so they run one at a time.
let settingsQueue: Promise<unknown> = Promise.resolve()

export function writeSettings(changes: SettingValues): Promise<Result> {
  const literals = new Map<string, string>()
  for (const [key, value] of Object.entries(changes)) {
    const type = SETTING_TYPES.get(key)
    const literal = type ? formatValue(value, type) : null
    if (literal === null) {
      return Promise.resolve({ ok: false, error: `Invalid value for setting "${key}".` })
    }
    literals.set(key, literal)
  }

  const write = settingsQueue.then(() => applySettings(literals))
  settingsQueue = write.catch(() => undefined)
  return write
}

async function applySettings(literals: Map<string, string>): Promise<Result> {
  let text = ''
  try {
    text = await readFile(settingsPath(), 'utf8')
  } catch {
    // No settings file yet: the game fills in the rest on first launch.
  }
  await mkdir(userRoot(), { recursive: true })
  await writeFile(settingsPath(), updateFlatToml(text, literals))
  return { ok: true }
}
