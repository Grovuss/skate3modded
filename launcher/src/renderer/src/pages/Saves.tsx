import { useCallback, useEffect, useState } from 'react'
import type { GameStatus, Result, SaveBackup } from '@shared/types'
import { ConfirmButton, EmptyState, Icon, PageHeader, formatBytes, type Notify } from '../ui'

interface Props {
  status: GameStatus
  notify: Notify
}

export function Saves({ status, notify }: Props) {
  const [backups, setBackups] = useState<SaveBackup[] | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => setBackups(await window.skate.listBackups()), [])
  useEffect(() => void reload(), [reload])

  const run = async (action: Promise<Result>, done: string): Promise<boolean> => {
    setBusy(true)
    const result = await action
    setBusy(false)
    notify(result.ok ? done : (result.error ?? 'Something went wrong.'), result.ok ? 'info' : 'error')
    await reload()
    return result.ok
  }

  const create = async (): Promise<void> => {
    if (await run(window.skate.createBackup(note), 'Backup created.')) setNote('')
  }

  return (
    <div className="page">
      <PageHeader
        title="Saves"
        subtitle={
          status.portableSaves
            ? 'Back up and restore your career, profiles and settings. Using the portable saves folder beside the executable.'
            : 'Back up and restore your career, profiles and settings.'
        }
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void window.skate.openPath('backups')}
          >
            <Icon name="folder" size={16} />
            Backups folder
          </button>
        }
      />

      <form
        className="row create-row"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <input
          className="input"
          aria-label="Backup note"
          placeholder="Note (optional), e.g. Before trying mods"
          maxLength={80}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Back up now
        </button>
      </form>

      {backups && backups.length === 0 && (
        <EmptyState title="No backups yet">
          Create one before experimenting. Restoring always backs up your current saves first.
        </EmptyState>
      )}

      {backups && backups.length > 0 && (
        <div className="list">
          {backups.map((backup) => (
            <div className="list-row" key={backup.id}>
              <div className="list-text">
                <span>{new Date(backup.createdAt).toLocaleString()}</span>
                <small>
                  {backup.note && `${backup.note} · `}
                  {backup.fileCount} files · {formatBytes(backup.sizeBytes)}
                </small>
              </div>
              <div className="row">
                <ConfirmButton
                  label="Restore"
                  confirmLabel="Replace current saves?"
                  disabled={busy || status.running}
                  onConfirm={() => void run(window.skate.restoreBackup(backup.id), 'Saves restored.')}
                />
                <ConfirmButton
                  danger
                  label="Delete"
                  confirmLabel="Delete backup?"
                  disabled={busy}
                  onConfirm={() => void run(window.skate.deleteBackup(backup.id), 'Backup deleted.')}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
