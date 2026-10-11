import { useEffect, useState } from 'react'
import type { BuildInfo, GameStatus, InstallProgress } from '@shared/types'
import mark from '../assets/mark.png'
import wordmark from '../assets/wordmark.png'
import { Icon, fileName, type Notify } from '../ui'

interface Props {
  status: GameStatus
  setStatus: (status: GameStatus) => void
  notify: Notify
  /** Non-null while the build or the game files are being installed. */
  progress: InstallProgress | null
}

const PROGRESS_LABELS: Record<InstallProgress['phase'], string> = {
  download: 'Downloading the Skate 3 build…',
  extract: 'Installing the Skate 3 build…',
  game: 'Installing the game files from your ISO…'
}

export function Home({ status, setStatus, notify, progress }: Props) {
  const [build, setBuild] = useState<BuildInfo | null>(null)
  useEffect(() => {
    void window.skate.checkBuild().then(setBuild)
  }, [status.exePath, status.installedVersion, status.checkUpdates])

  /** Installs whatever is still missing (build, then game files), then starts the game. */
  const play = async (): Promise<void> => {
    let current = await window.skate.getStatus()
    if (!current.exeFound) {
      const installed = await window.skate.installBuild()
      if (!installed.ok) return notify(installed.error ?? 'The build could not be installed.', 'error')
      current = await window.skate.getStatus()
    }
    if (!current.gameInstalled) {
      const installed = await window.skate.installGame()
      if (!installed.ok) {
        return notify(installed.error ?? 'The game files could not be installed.', 'error')
      }
    }
    const result = await window.skate.launch()
    if (!result.ok) notify(result.error ?? 'Could not start Skate 3.', 'error')
  }

  const update = async (): Promise<void> => {
    const result = await window.skate.installBuild()
    notify(
      result.ok ? 'Skate 3 is up to date.' : (result.error ?? 'The update failed.'),
      result.ok ? 'info' : 'error'
    )
  }

  const locate = async (): Promise<void> => setStatus(await window.skate.pickExecutable())
  const pickIso = async (): Promise<void> => setStatus(await window.skate.pickIso())

  const exeName = status.platform === 'win32' ? 'skate3.exe' : 'skate3'
  const ready = status.exeFound && status.gameInstalled
  const missingIso = !status.gameInstalled && !status.isoPath
  /** No build yet and no way to download one on this platform. */
  const mustLocate = !status.exeFound && build?.canInstall === false

  return (
    <div className="page home">
      <section className="hero">
        <img className="hero-mark" src={mark} alt="" draggable={false} />
        <div className="hero-body">
          <span className="eyebrow">Launcher &amp; modding hub</span>
          <h1 className="wordmark">
            <img src={wordmark} alt="Skate 3" draggable={false} />
          </h1>

          {progress ? (
            <>
              <p className="hero-text">
                {PROGRESS_LABELS[progress.phase]} {Math.round(progress.fraction * 100)}%
              </p>
              <div
                className="progress"
                role="progressbar"
                aria-label="Install progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.fraction * 100)}
              >
                <span style={{ width: `${progress.fraction * 100}%` }} />
              </div>
            </>
          ) : ready || status.running ? (
            <>
              <p className="hero-text">Game files installed. Ready to drop in.</p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-play"
                  disabled={status.running}
                  onClick={() => void play()}
                >
                  <Icon name="play" size={20} />
                  {status.running ? 'Running' : 'Play'}
                </button>
                {build?.updateAvailable && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={status.running}
                    onClick={() => void update()}
                  >
                    Update to {build.latestVersion}
                  </button>
                )}
              </div>
            </>
          ) : missingIso ? (
            <>
              <p className="hero-text">
                <strong>Skate 3 ISO missing.</strong> Skate³ installs the game from a disc image of
                your own Xbox 360 copy of Skate 3. Choose the ISO file, or put it in a folder named
                GameISO next to the launcher.
              </p>
              <div className="row">
                <button type="button" className="btn btn-play" onClick={() => void pickIso()}>
                  Choose ISO
                </button>
              </div>
            </>
          ) : mustLocate ? (
            <>
              <p className="hero-text">
                Point Skate³ at your Skate 3 recompilation ({exeName}) to get started.
              </p>
              <div className="row">
                <button type="button" className="btn btn-play" onClick={() => void locate()}>
                  Locate {exeName}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hero-text">
                {status.exeFound
                  ? `Play installs the game files from ${fileName(status.isoPath)} first. This takes a minute or two.`
                  : `Play downloads the Skate 3 PC build, installs the game files from ${fileName(status.isoPath)}, then starts the game.`}
              </p>
              <div className="row">
                <button type="button" className="btn btn-play" onClick={() => void play()}>
                  <Icon name="play" size={20} />
                  Install &amp; play
                </button>
                {!status.exeFound && (
                  <button type="button" className="btn btn-ghost" onClick={() => void locate()}>
                    Locate {exeName}
                  </button>
                )}
              </div>
              {build?.error && <span className="hint">{build.error}</span>}
            </>
          )}
        </div>
      </section>

      <section className="cards">
        <div className="card">
          <span className="card-label">
            Game build {status.installedVersion && `· ${status.installedVersion}`}
          </span>
          <span className="card-value path" title={status.exePath ?? undefined}>
            {status.exePath ?? 'Not installed'}
          </span>
          <div className="row">
            {status.exeFound && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.skate.openPath('gameDir')}
              >
                <Icon name="folder" size={16} />
                Open folder
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <span className="card-label">Game files</span>
          <span className="card-value">
            {status.gameInstalled
              ? 'Installed'
              : status.isoPath
                ? `Ready to install from ${fileName(status.isoPath)}`
                : 'ISO missing'}
          </span>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!!progress}
              onClick={() => void pickIso()}
            >
              {status.isoPath ? 'Change ISO' : 'Choose ISO'}
            </button>
          </div>
        </div>

        <div className="card">
          <span className="card-label">User data {status.portable && '· portable'}</span>
          <span className="card-value path" title={status.userRoot}>
            {status.userRoot}
          </span>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void window.skate.openPath('userRoot')}
            >
              <Icon name="folder" size={16} />
              Open folder
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
