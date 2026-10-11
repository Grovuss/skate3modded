import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/types'

/** Subscribes to a main-process event; returns the unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatus: (listener) => subscribe('status', listener),
  onNotice: (listener) => subscribe('notice', listener),
  pickExecutable: () => ipcRenderer.invoke('game:pick'),
  pickIso: () => ipcRenderer.invoke('game:pick-iso'),
  setExtraArgs: (args) => ipcRenderer.invoke('game:args', args),
  setLauncherOptions: (options) => ipcRenderer.invoke('launcher:options', options),
  launch: () => ipcRenderer.invoke('game:launch'),
  openPath: (target) => ipcRenderer.invoke('open:path', target),

  checkBuild: () => ipcRenderer.invoke('build:check'),
  installBuild: () => ipcRenderer.invoke('build:install'),
  installGame: () => ipcRenderer.invoke('game:install'),
  onInstallProgress: (listener) => subscribe('install-progress', listener),

  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (changes) => ipcRenderer.invoke('settings:write', changes),

  listBackups: () => ipcRenderer.invoke('saves:list'),
  createBackup: (note) => ipcRenderer.invoke('saves:create', note),
  restoreBackup: (id) => ipcRenderer.invoke('saves:restore', id),
  deleteBackup: (id) => ipcRenderer.invoke('saves:delete', id),

  listDlc: () => ipcRenderer.invoke('dlc:list'),
  addDlc: () => ipcRenderer.invoke('dlc:add'),
  removeDlc: (fileName) => ipcRenderer.invoke('dlc:remove', fileName),

  listMods: () => ipcRenderer.invoke('mods:list'),
  addMod: (source) => ipcRenderer.invoke('mods:add', source),
  setModEnabled: (id, enabled) => ipcRenderer.invoke('mods:enable', id, enabled),
  moveMod: (id, delta) => ipcRenderer.invoke('mods:move', id, delta),
  removeMod: (id) => ipcRenderer.invoke('mods:remove', id),

  listArchives: () => ipcRenderer.invoke('files:archives'),
  listArchiveEntries: (archive) => ipcRenderer.invoke('files:entries', archive),
  extractEntries: (archive, entries, png) => ipcRenderer.invoke('files:extract', archive, entries, png)
}

contextBridge.exposeInMainWorld('skate', api)
