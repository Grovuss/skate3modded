import { useCallback, useEffect, useState } from 'react'
import type { DlcPackage, GameStatus, Result } from '@shared/types'
import { ConfirmButton, EmptyState, Icon, PageHeader, formatBytes, type Notify } from '../ui'

interface Props {
  status: GameStatus
  notify: Notify
}

export function Dlc({ status, notify }: Props) {
  const [packages, setPackages] = useState<DlcPackage[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => setPackages(await window.skate.listDlc()), [])
  // The game installs packages while it runs, so refresh when it starts or exits.
  useEffect(() => void reload(), [reload, status.running])

  const run = async (action: Promise<Result>): Promise<void> => {
    setBusy(true)
    const result = await action
    setBusy(false)
    if (!result.ok) notify(result.error ?? 'Something went wrong.', 'error')
    await reload()
  }

  return (
    <div className="page">
      <PageHeader
        title="DLC"
        subtitle="Package files from your own Xbox 360 DLC. The game installs them the next time it starts."
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void window.skate.openPath('dlc')}
            >
              <Icon name="folder" size={16} />
              DLC folder
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void run(window.skate.addDlc())}
            >
              Add packages
            </button>
          </>
        }
      />

      {packages && packages.length === 0 && (
        <EmptyState title="No DLC added">
          Add the package files from your legally obtained Skate 3 DLC.
        </EmptyState>
      )}

      {packages && packages.length > 0 && (
        <div className="list">
          {packages.map((item) => (
            <div className="list-row" key={item.fileName}>
              <div className="list-text">
                <span>{item.displayName ?? item.fileName}</span>
                <small className="path">
                  {item.displayName && `${item.fileName} · `}
                  {formatBytes(item.sizeBytes)}
                </small>
              </div>
              <div className="row">
                {!item.valid ? (
                  <span className="badge warn" title="The game skips files that are not DLC packages.">
                    Not a DLC package
                  </span>
                ) : item.installed ? (
                  <span className="badge good">Installed</span>
                ) : (
                  <span className="badge">Installs on next launch</span>
                )}
                <ConfirmButton
                  danger
                  label="Remove"
                  confirmLabel="Move to recycle bin?"
                  disabled={busy || status.running}
                  onConfirm={() => void run(window.skate.removeDlc(item.fileName))}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
