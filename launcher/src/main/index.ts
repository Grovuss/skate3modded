import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LauncherOptions, Result, SettingValues } from '@shared/types'
import { checkBuild, installBuild } from './build'
import { addDlc, dlcRoot, listDlc, removeDlc } from './dlc'
import {
  exeDir,
  getStatus,
  launch,
  loadConfig,
  onNotice,
  onStatusChanged,
  readSettings,
  setLauncherOptions,
  updateConfig,
  userRoot,
  writeSettings
} from './game'
import { extractEntries, extractedRoot, listArchives, listEntries } from './gamefiles'
import { installGameFiles } from './iso'
import { importMod, libraryRoot, listMods, moveMod, removeMod, setModEnabled } from './mods'
import { backupsRoot, createBackup, deleteBackup, listBackups, restoreBackup } from './saves'

const BACKGROUND = '#0a0c11'
const CLOSE_AFTER_LAUNCH_MS = 6000

// An ASCII folder name: the product name's superscript does not belong in paths.
// Chromium's own --user-data-dir switch still wins when given.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'Skate3Cubed'))
}

let window: BrowserWindow | null = null

function createWindow(): void {
  window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'Skate³',
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? false
        : { color: BACKGROUND, symbolColor: '#8b93a7', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => (window = null))
  // Refresh state the user may have changed outside the launcher.
  window.on('focus', () => window?.webContents.send('status', getStatus()))

  // The UI is a single local page: nothing navigates and nothing opens windows.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Runs a file operation and reports failures to the UI instead of throwing. */
async function attempt(operation: () => Promise<Result> | Result): Promise<Result> {
  try {
    return await operation()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => getStatus())
  ipcMain.handle('game:pick', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Locate the Skate 3 executable',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Skate 3', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePaths[0]) await updateConfig({ exePath: result.filePaths[0] })
    return getStatus()
  })
  ipcMain.handle('game:pick-iso', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Select your Skate 3 ISO',
      properties: ['openFile'],
      filters: [{ name: 'Xbox 360 disc image', extensions: ['iso'] }]
    })
    if (!result.canceled && result.filePaths[0]) await updateConfig({ isoPath: result.filePaths[0] })
    return getStatus()
  })
  ipcMain.handle('game:args', async (_event, args: unknown) => {
    await updateConfig({ extraArgs: String(args ?? '') })
    return getStatus()
  })
  ipcMain.handle('launcher:options', async (_event, options: unknown) => {
    await setLauncherOptions((options ?? {}) as LauncherOptions)
    return getStatus()
  })
  ipcMain.handle('game:launch', async () => {
    const result = await attempt(launch)
    const { afterLaunch } = getStatus()
    if (result.ok && afterLaunch === 'minimize') window?.minimize()
    if (result.ok && afterLaunch === 'close') {
      // Stay long enough to report a game that fails to start.
      setTimeout(() => getStatus().running && app.quit(), CLOSE_AFTER_LAUNCH_MS)
    }
    return result
  })
  ipcMain.handle('game:install', () =>
    attempt(() =>
      installGameFiles((progress) => window?.webContents.send('install-progress', progress))
    )
  )
  ipcMain.handle('build:check', () => checkBuild())
  ipcMain.handle('build:install', () =>
    attempt(() => installBuild((progress) => window?.webContents.send('install-progress', progress)))
  )
  ipcMain.handle('open:path', async (_event, target: unknown) => {
    const paths: Record<string, string | null> = {
      userRoot: userRoot(),
      gameDir: exeDir(),
      dlc: dlcRoot(),
      backups: backupsRoot(),
      mods: libraryRoot(),
      extracted: extractedRoot()
    }
    const path = paths[String(target)]
    if (!path) return
    await mkdir(path, { recursive: true })
    await shell.openPath(path)
  })

  ipcMain.handle('settings:read', () => readSettings())
  ipcMain.handle('settings:write', (_event, changes: SettingValues) =>
    attempt(() => writeSettings(changes))
  )

  ipcMain.handle('saves:list', () => listBackups())
  ipcMain.handle('saves:create', (_event, note: unknown) =>
    attempt(() => createBackup(String(note ?? '')))
  )
  ipcMain.handle('saves:restore', (_event, id: unknown) => attempt(() => restoreBackup(String(id))))
  ipcMain.handle('saves:delete', (_event, id: unknown) => attempt(() => deleteBackup(String(id))))

  ipcMain.handle('dlc:list', () => listDlc())
  ipcMain.handle('dlc:add', () =>
    attempt(async () => {
      const result = await dialog.showOpenDialog(window!, {
        title: 'Add Skate 3 DLC packages',
        properties: ['openFile', 'multiSelections']
      })
      return result.canceled ? { ok: true } : addDlc(result.filePaths)
    })
  )
  ipcMain.handle('dlc:remove', (_event, fileName: unknown) =>
    attempt(() => removeDlc(String(fileName)))
  )

  ipcMain.handle('mods:list', () => listMods())
  ipcMain.handle('mods:add', (_event, source: unknown) =>
    attempt(async () => {
      const result = await dialog.showOpenDialog(
        window!,
        source === 'folder'
          ? { title: 'Add a mod folder', properties: ['openDirectory'] }
          : {
              title: 'Add mod archives',
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'Zip archives', extensions: ['zip'] }]
            }
      )
      if (result.canceled) return { ok: true }
      for (const path of result.filePaths) {
        const imported = await importMod(path)
        if (!imported.ok) return imported
      }
      return { ok: true }
    })
  )
  ipcMain.handle('mods:enable', (_event, id: unknown, enabled: unknown) =>
    attempt(() => setModEnabled(String(id), enabled === true))
  )
  ipcMain.handle('mods:move', (_event, id: unknown, delta: unknown) =>
    attempt(() => moveMod(String(id), Number(delta)))
  )
  ipcMain.handle('mods:remove', (_event, id: unknown) => attempt(() => removeMod(String(id))))

  ipcMain.handle('files:archives', () => listArchives())
  ipcMain.handle('files:entries', (_event, archive: unknown) =>
    listEntries(String(archive)).catch(() => [])
  )
  ipcMain.handle('files:extract', (_event, archive: unknown, entries: unknown, png: unknown) =>
    attempt(() =>
      extractEntries(String(archive), Array.isArray(entries) ? entries.map(String) : [], png === true)
    )
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    await loadConfig()
    registerIpc()
    onStatusChanged(() => window?.webContents.send('status', getStatus()))
    onNotice((message) => window?.webContents.send('notice', message))
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
