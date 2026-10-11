import { app } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BuildInfo, InstallProgress, Result } from '@shared/types'
import {
  EXE_NAME,
  getStatus,
  isRunning,
  managedDir,
  managedExe,
  updateConfig
} from './game'
import { reapplyMenuTheme } from './menuTheme'
import { extractZip, listZip } from './zip'

// Release builds of the recompilation the launcher installs and keeps updated.
const RELEASE_API = 'https://api.github.com/repos/mchughalex/skate3recomp/releases/latest'
const DOWNLOAD_PREFIX = 'https://github.com/mchughalex/skate3recomp/releases/download/'

/** Release asset per platform. macOS ships an app bundle the launcher does not manage. */
const ASSET_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Skate3Recomp-Windows.zip',
  linux: 'Skate3Recomp-Linux.zip'
}

/** How a just-downloaded file fails to open once antivirus has quarantined or locked it. */
const BLOCKED_CODES = new Set(['UNKNOWN', 'ENOENT', 'EPERM', 'EACCES', 'EBUSY'])
const BLOCKED_MESSAGE =
  'Your antivirus blocked the downloaded Skate 3 build, so it was not installed. ' +
  'Check your security software, or get the build yourself and use "Locate".'

interface Release {
  tag: string
  url: string
  size: number
}

let installing = false

async function fetchLatest(): Promise<Release> {
  const assetName = ASSET_NAMES[process.platform]
  if (!assetName) throw new Error('Automatic install is not available on this platform.')

  const response = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'skate3-cubed' }
  })
  if (!response.ok) throw new Error(`Could not reach the release server (HTTP ${response.status}).`)

  const release = (await response.json()) as {
    tag_name?: string
    assets?: { name: string; size: number; browser_download_url: string }[]
  }
  const asset = release.assets?.find((item) => item.name === assetName)
  if (!release.tag_name || !asset || !asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)) {
    throw new Error(`The latest release has no ${assetName} download.`)
  }
  return { tag: release.tag_name, url: asset.browser_download_url, size: asset.size }
}

export async function checkBuild(): Promise<BuildInfo> {
  const canInstall = process.platform in ASSET_NAMES
  const status = getStatus()
  // With update checks off, the release server is only contacted to install.
  if (!canInstall || (!status.checkUpdates && status.exeFound)) {
    return { canInstall, latestVersion: null, updateAvailable: false }
  }
  try {
    const latest = await fetchLatest()
    return {
      canInstall,
      latestVersion: latest.tag,
      updateAvailable: status.managed && status.exeFound && status.installedVersion !== latest.tag
    }
  } catch (error) {
    return {
      canInstall,
      latestVersion: null,
      updateAvailable: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function download(
  release: Release,
  target: string,
  onProgress: (progress: InstallProgress) => void
): Promise<void> {
  const response = await fetch(release.url, { headers: { 'User-Agent': 'skate3-cubed' } })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`)
  }

  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      onProgress({ phase: 'download', fraction: Math.min(received / release.size, 1) })
      done(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(target))

  if ((await stat(target)).size !== release.size) {
    throw new Error('The download was incomplete. Try again.')
  }
}

/**
 * Installs the latest build into the launcher's own folder, or updates it in
 * place. Only files in the release archive are written, so the extracted game
 * data, saves and DLC beside the executable are left alone.
 */
export async function installBuild(
  onProgress: (progress: InstallProgress | null) => void
): Promise<Result> {
  if (installing) return { ok: false, error: 'An install is already in progress.' }
  if (isRunning()) return { ok: false, error: 'Close Skate 3 before updating it.' }

  installing = true
  const archive = join(app.getPath('temp'), 'skate3cubed-build.zip')
  try {
    const release = await fetchLatest()
    onProgress({ phase: 'download', fraction: 0 })
    await download(release, archive, onProgress)

    // The archive may wrap the build in a folder: install from wherever the executable sits.
    const names = await listZip(archive).catch((error: NodeJS.ErrnoException) => {
      // The file was complete a moment ago: security software took it away.
      if (BLOCKED_CODES.has(error.code ?? '')) throw new Error(BLOCKED_MESSAGE)
      throw error
    })
    const executable = names
      .filter((name) => posix.basename(name) === EXE_NAME)
      .sort((a, b) => a.length - b.length)[0]
    if (!executable) throw new Error(`The release archive does not contain ${EXE_NAME}.`)
    const prefix = executable.slice(0, executable.length - EXE_NAME.length)

    onProgress({ phase: 'extract', fraction: 1 })
    await mkdir(managedDir(), { recursive: true })
    await extractZip(archive, managedDir(), (name) =>
      name.startsWith(prefix) ? name.slice(prefix.length) : null
    )
    await updateConfig({ exePath: managedExe(), managedVersion: release.tag })
    // The update replaced the runtime library: colour the new one if the option is on.
    await reapplyMenuTheme(getStatus().menuTheme)
    return { ok: true }
  } finally {
    installing = false
    onProgress(null)
    await rm(archive, { force: true })
  }
}
