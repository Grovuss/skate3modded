import { useCallback, useEffect, useState } from 'react'
import type { GameStatus, ModInfo, Result } from '@shared/types'
import {
  ConfirmButton,
  EmptyState,
  Icon,
  PageHeader,
  Toggle,
  formatBytes,
  type Notify
} from '../ui'

interface Props {
  status: GameStatus
  notify: Notify
}

export function Mods({ status, notify }: Props) {
  const [mods, setMods] = useState<ModInfo[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => setMods(await window.skate.listMods()), [])
  useEffect(() => void reload(), [reload, status.exePath])

  const run = async (action: Promise<Result>): Promise<void> => {
    setBusy(true)
    const result = await action
    setBusy(false)
    if (!result.ok) notify(result.error ?? 'Something went wrong.', 'error')
    else if (result.warning) notify(result.warning)
    await reload()
  }

  const locked = busy || status.running

  return (
    <div className="page">
      <PageHeader
        title="Mods"
        subtitle="Replacements for game files and for single files inside the game's archives. Originals are kept and restored when a mod is switched off."
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void run(window.skate.addMod('folder'))}
            >
              <Icon name="folder" size={16} />
              Add folder
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void run(window.skate.addMod('zip'))}
            >
              Add zip
            </button>
          </>
        }
      />

      {status.running && (
        <div className="notice">Skate 3 is running. Close the game to change mods.</div>
      )}
      {!status.running && !status.gameInstalled && (
        <div className="notice">
          The game files are not installed yet. You can add mods now and switch them on once the
          game is set up.
        </div>
      )}

      {mods && mods.length === 0 && (
        <EmptyState title="No mods added">
          Add a zip or folder whose contents mirror the game folder, for example{' '}
          <span className="path">data/content/…</span>. To change one file inside an archive, put it
          in a folder named after the archive; the Game files page shows the paths.
        </EmptyState>
      )}

      {mods && mods.length > 0 && (
        <div className="list">
          {mods.map((mod, index) => (
            <div className="list-row" key={mod.id}>
              <Toggle
                label={`Enable ${mod.name}`}
                checked={mod.enabled}
                disabled={locked}
                onChange={(enabled) => void run(window.skate.setModEnabled(mod.id, enabled))}
              />
              <div className="list-text grow" title={mod.description || undefined}>
                <span>
                  {mod.name}
                  {mod.version && <span className="muted"> {mod.version}</span>}
                </span>
                <small>
                  {mod.author && `${mod.author} · `}
                  {mod.fileCount} {mod.fileCount === 1 ? 'file' : 'files'} ·{' '}
                  {formatBytes(mod.sizeBytes)}
                </small>
                {mod.conflicts.map((conflict) => (
                  <small className="warn-text" key={conflict.name}>
                    {conflict.wins ? 'Overrides' : 'Overridden by'} {conflict.name} on{' '}
                    {conflict.fileCount} {conflict.fileCount === 1 ? 'file' : 'files'}
                  </small>
                ))}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={`Move ${mod.name} up`}
                  title="Higher priority"
                  disabled={locked || index === 0}
                  onClick={() => void run(window.skate.moveMod(mod.id, -1))}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={`Move ${mod.name} down`}
                  title="Lower priority"
                  disabled={locked || index === mods.length - 1}
                  onClick={() => void run(window.skate.moveMod(mod.id, 1))}
                >
                  <Icon name="down" size={16} />
                </button>
                <ConfirmButton
                  danger
                  label="Remove"
                  confirmLabel="Remove mod?"
                  disabled={locked}
                  onConfirm={() => void run(window.skate.removeMod(mod.id))}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {mods && mods.length > 1 && (
        <span className="hint">
          When two enabled mods replace the same file, the one higher in the list wins.
        </span>
      )}
    </div>
  )
}
