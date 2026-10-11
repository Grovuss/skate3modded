import { useEffect, useState } from 'react'
import type { AfterLaunch, GameStatus, InstallProgress } from '@shared/types'
import { ConfirmButton, Icon, Toggle, fileName, type Notify } from '../ui'

interface Props {
  status: GameStatus
  setStatus: (status: GameStatus) => void
  notify: Notify
  progress: InstallProgress | null
}

const AFTER_LAUNCH: { value: AfterLaunch; label: string }[] = [
  { value: 'keep', label: 'Keep the launcher open' },
  { value: 'minimize', label: 'Minimize the launcher' },
  { value: 'close', label: 'Close the launcher' }
]

/** Options for the launcher itself, as opposed to the game's own settings file. */
export function LauncherSettings({ status, setStatus, notify, progress }: Props) {
  const [args, setArgs] = useState(status.extraArgs)
  useEffect(() => setArgs(status.extraArgs), [status.extraArgs])

  const saveArgs = async (): Promise<void> => {
    if (args !== status.extraArgs) setStatus(await window.skate.setExtraArgs(args))
  }

  const reinstall = async (): Promise<void> => {
    const result = await window.skate.installGame()
    notify(
      result.ok ? 'Game files reinstalled.' : (result.error ?? 'The reinstall failed.'),
      result.ok ? 'info' : 'error'
    )
  }

  const busy = !!progress || status.running

  return (
    <div className="list">
      <div className="list-row">
        <div className="list-text">
          <span>When the game starts</span>
        </div>
        <select
          className="select"
          aria-label="When the game starts"
          value={status.afterLaunch}
          onChange={async (event) =>
            setStatus(
              await window.skate.setLauncherOptions({ afterLaunch: event.target.value as AfterLaunch })
            )
          }
        >
          {AFTER_LAUNCH.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="list-row">
        <div className="list-text">
          <span>Check for game updates</span>
          <small>Looks for a newer Skate 3 build when the launcher opens.</small>
        </div>
        <Toggle
          label="Check for game updates"
          checked={status.checkUpdates}
          onChange={async (checkUpdates) =>
            setStatus(await window.skate.setLauncherOptions({ checkUpdates }))
          }
        />
      </div>

      <div className="list-row">
        <div className="list-text">
          <span>Skate³ colours in the game's menu</span>
          <small>
            Recolours the game build's own settings menu, FPS counter and overlays. The original is
            kept and put back when this is switched off.
          </small>
        </div>
        <Toggle
          label="Skate³ colours in the game's menu"
          checked={status.menuTheme}
          disabled={busy}
          onChange={async (on) => {
            const result = await window.skate.setMenuTheme(on)
            if (!result.ok) notify(result.error ?? 'Something went wrong.', 'error')
            setStatus(await window.skate.getStatus())
          }}
        />
      </div>

      <div className="list-row">
        <div className="list-text">
          <label htmlFor="extra-args">Launch arguments</label>
          <small>Passed to the game every time it starts, e.g. --fullscreen=false</small>
        </div>
        <input
          id="extra-args"
          className="input narrow"
          spellCheck={false}
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          onBlur={() => void saveArgs()}
        />
      </div>

      <div className="list-row">
        <div className="list-text">
          <span>Game build {status.installedVersion && `(${status.installedVersion})`}</span>
          <small className="path">{status.exePath ?? 'Not installed'}</small>
        </div>
        <div className="row">
          {status.exeFound && (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Open the game folder"
              title="Open folder"
              onClick={() => void window.skate.openPath('gameDir')}
            >
              <Icon name="folder" size={16} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => setStatus(await window.skate.pickExecutable())}
          >
            Use another build
          </button>
        </div>
      </div>

      <div className="list-row">
        <div className="list-text">
          <span>Skate 3 ISO</span>
          <small className="path">{status.isoPath ?? 'Not chosen'}</small>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!!progress}
          onClick={async () => setStatus(await window.skate.pickIso())}
        >
          {status.isoPath ? 'Change' : 'Choose'}
        </button>
      </div>

      <div className="list-row">
        <div className="list-text">
          <span>Game files</span>
          <small>
            {progress?.phase === 'game'
              ? `Installing… ${Math.round(progress.fraction * 100)}%`
              : status.gameInstalled
                ? `Installed. Reinstalling extracts them again from ${fileName(status.isoPath) || 'your ISO'}.`
                : 'Not installed yet. Press Play to install them.'}
          </small>
        </div>
        <ConfirmButton
          label="Reinstall"
          confirmLabel="Overwrite game files?"
          disabled={busy || !status.exeFound || !status.isoPath || !status.gameInstalled}
          onConfirm={() => void reinstall()}
        />
      </div>
    </div>
  )
}
