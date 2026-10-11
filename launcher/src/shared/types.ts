export type SettingValue = string | number | boolean
export type SettingValues = Record<string, SettingValue>

export interface LauncherConfig {
  /** Absolute path to the skate3 executable, or null until located. */
  exePath: string | null
  /** Extra command-line arguments appended on launch. */
  extraArgs: string
  /** Release tag of the build the launcher installed itself, if any. */
  managedVersion: string | null
  /** Skate 3 ISO the user chose for installing the game files, if any. */
  isoPath: string | null
  afterLaunch: AfterLaunch
  /** Look for a newer game build when the launcher opens. */
  checkUpdates: boolean
}

/** What the launcher window does once the game has started. */
export type AfterLaunch = 'keep' | 'minimize' | 'close'

export type LauncherOptions = Partial<Pick<LauncherConfig, 'afterLaunch' | 'checkUpdates'>>

export interface GameStatus {
  platform: NodeJS.Platform
  exePath: string | null
  exeFound: boolean
  /** True when the executable is the build the launcher downloads and updates. */
  managed: boolean
  /** Release tag of the managed build. */
  installedVersion: string | null
  /** <exe dir>/game: where the in-game ISO installer extracts the game. */
  gameRoot: string | null
  gameInstalled: boolean
  /** ISO the game files will be installed from: the chosen one, or one found in a GameISO folder. */
  isoPath: string | null
  /** Folder holding settings.toml, saves, profiles and the dlc drop folder. */
  userRoot: string
  portable: boolean
  /** True when a "saves" folder beside the executable overrides the save location. */
  portableSaves: boolean
  running: boolean
  extraArgs: string
  afterLaunch: AfterLaunch
  checkUpdates: boolean
}

export interface BuildInfo {
  /** False on platforms the launcher cannot install a build for. */
  canInstall: boolean
  latestVersion: string | null
  updateAvailable: boolean
  /** Set when the release server could not be reached. */
  error?: string
}

export interface InstallProgress {
  /** Downloading the build, unpacking it, or extracting the game files from the ISO. */
  phase: 'download' | 'extract' | 'game'
  /** 0..1 */
  fraction: number
}

export interface SaveBackup {
  id: string
  createdAt: number
  note: string
  sizeBytes: number
  fileCount: number
}

export interface DlcPackage {
  fileName: string
  path: string
  sizeBytes: number
  /** Display name from the package header, when it is a readable STFS package. */
  displayName: string | null
  /** False when the file is not a marketplace-content STFS package (the game will skip it). */
  valid: boolean
  /** True once the game has extracted it into its content folder. */
  installed: boolean
}

export interface ModConflict {
  /** The other enabled mod that replaces some of the same files. */
  name: string
  fileCount: number
  /** True when this mod is higher in the list and so wins those files. */
  wins: boolean
}

export interface ModInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  fileCount: number
  sizeBytes: number
  enabled: boolean
  conflicts: ModConflict[]
}

export interface Result {
  ok: boolean
  error?: string
  /** Set when the request succeeded but something was done only in part. */
  warning?: string
}

/** One of the game's .big archives. */
export interface ArchiveInfo {
  /** Path under the game data root, forward slashes. */
  path: string
  sizeBytes: number
  entryCount: number
}

export interface ArchiveEntryInfo {
  /** Path inside the archive, or "#<hash>" in archives that carry no file names. */
  path: string
  sizeBytes: number
}

export interface ExtractResult extends Result {
  /** Folder the files were written to. */
  folder?: string
  files?: number
  /** Textures also saved as PNG. */
  images?: number
  /** Text tables also listed as a strings file. */
  texts?: number
  failed?: number
}

export interface Api {
  getStatus(): Promise<GameStatus>
  onStatus(listener: (status: GameStatus) => void): () => void
  /** Problems reported by the launcher outside a direct request, e.g. the game failing to start. */
  onNotice(listener: (message: string) => void): () => void
  pickExecutable(): Promise<GameStatus>
  pickIso(): Promise<GameStatus>
  setExtraArgs(args: string): Promise<GameStatus>
  setLauncherOptions(options: LauncherOptions): Promise<GameStatus>
  launch(): Promise<Result>
  openPath(target: 'userRoot' | 'gameDir' | 'dlc' | 'backups' | 'mods' | 'extracted'): Promise<void>

  checkBuild(): Promise<BuildInfo>
  /** Downloads the latest build, or updates the managed one in place. */
  installBuild(): Promise<Result>
  /** Extracts the game files from the chosen ISO into the game folder. */
  installGame(): Promise<Result>
  onInstallProgress(listener: (progress: InstallProgress | null) => void): () => void

  readSettings(): Promise<SettingValues>
  writeSettings(changes: SettingValues): Promise<Result>

  listBackups(): Promise<SaveBackup[]>
  createBackup(note: string): Promise<Result>
  restoreBackup(id: string): Promise<Result>
  deleteBackup(id: string): Promise<Result>

  listDlc(): Promise<DlcPackage[]>
  addDlc(): Promise<Result>
  removeDlc(fileName: string): Promise<Result>

  listMods(): Promise<ModInfo[]>
  addMod(source: 'zip' | 'folder'): Promise<Result>
  setModEnabled(id: string, enabled: boolean): Promise<Result>
  /** Moves a mod up (-1) or down (+1) the priority list. */
  moveMod(id: string, delta: -1 | 1): Promise<Result>
  removeMod(id: string): Promise<Result>

  /** The game's archives, for mod authors. Always the unmodded copies. */
  listArchives(): Promise<ArchiveInfo[]>
  listArchiveEntries(archive: string): Promise<ArchiveEntryInfo[]>
  /** Saves entries of an archive as loose files (and textures as PNG when asked). */
  extractEntries(archive: string, entries: string[], png: boolean): Promise<ExtractResult>
}
