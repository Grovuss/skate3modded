import { useEffect, useMemo, useState } from 'react'
import type { ArchiveEntryInfo, ArchiveInfo, GameStatus, ModInfo } from '@shared/types'
import { EmptyState, Icon, PageHeader, Toggle, formatBytes, type Notify } from '../ui'

interface Props {
  status: GameStatus
  notify: Notify
}

/** Rows drawn at once; the filter narrows large archives down. */
const VISIBLE_ROWS = 300

export function GameFiles({ status, notify }: Props) {
  const [archives, setArchives] = useState<ArchiveInfo[] | null>(null)
  const [selected, setSelected] = useState('')
  const [entries, setEntries] = useState<ArchiveEntryInfo[] | null>(null)
  const [filter, setFilter] = useState('')
  const [png, setPng] = useState(true)
  const [busy, setBusy] = useState(false)
  const [mods, setMods] = useState<ModInfo[]>([])
  const [modId, setModId] = useState('')

  useEffect(() => void window.skate.listMods().then(setMods), [])

  useEffect(() => {
    void window.skate.listArchives().then((found) => {
      setArchives(found)
      setSelected((current) => current || found[0]?.path || '')
    })
  }, [status.gameInstalled, status.exePath])

  useEffect(() => {
    setEntries(null)
    if (!selected) return
    let stale = false
    void window.skate.listArchiveEntries(selected).then((found) => !stale && setEntries(found))
    return () => {
      stale = true
    }
  }, [selected])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (entries ?? []).filter((entry) => !needle || entry.path.toLowerCase().includes(needle))
  }, [entries, filter])

  const extract = async (paths: string[]): Promise<void> => {
    setBusy(true)
    const result = await window.skate.extractEntries(selected, paths, png)
    setBusy(false)
    if (!result.ok) return notify(result.error ?? 'Something went wrong.', 'error')
    const images =
      (result.images ? `, ${result.images} as PNG` : '') +
      (result.texts ? `, ${result.texts} as editable text` : '')
    const failed = result.failed ? ` (${result.failed} could not be read)` : ''
    notify(`Extracted ${result.files} ${result.files === 1 ? 'file' : 'files'}${images}${failed}.`)
    void window.skate.openPath('extracted')
  }

  const toMod = async (paths: string[]): Promise<void> => {
    setBusy(true)
    const result = await window.skate.addToMod(modId, selected, paths)
    setBusy(false)
    if (!result.ok) return notify(result.error ?? 'Something went wrong.', 'error')
    const added = [
      result.images ? `${result.images} ${result.images === 1 ? 'image' : 'images'}` : '',
      result.texts ? 'a text file to add lines to' : '',
      result.files ? `${result.files} ${result.files === 1 ? 'file' : 'files'}` : ''
    ].filter(Boolean)
    notify(
      added.length
        ? `Added ${added.join(', ')} to the mod. Edit them, then press Reload on the Mods page.`
        : 'The mod already has these files.'
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Game files"
        subtitle="For mod authors: look inside the game's archives and extract the original files."
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void window.skate.openPath('extracted')}
          >
            <Icon name="folder" size={16} />
            Extracted files
          </button>
        }
      />

      {archives && archives.length === 0 && (
        <EmptyState title="No game files yet">
          Install the game from the Play page, then its archives are listed here.
        </EmptyState>
      )}

      {archives && archives.length > 0 && (
        <>
          <div className="row">
            <select
              className="select grow"
              style={{ minWidth: 0 }}
              aria-label="Archive"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {archives.map((archive) => (
                <option key={archive.path} value={archive.path}>
                  {archive.path} — {archive.entryCount} files, {formatBytes(archive.sizeBytes)}
                </option>
              ))}
            </select>
            <input
              className="input narrow"
              type="search"
              placeholder="Filter by name"
              aria-label="Filter files by name"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>

          <div className="row">
            <Toggle label="Also save textures as PNG" checked={png} onChange={setPng} />
            <span className="grow">Also save textures as PNG</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || shown.length === 0}
              onClick={() => void extract(shown.map((entry) => entry.path))}
            >
              {busy
                ? 'Extracting…'
                : `Extract ${filter.trim() ? 'matching' : 'all'} (${shown.length})`}
            </button>
          </div>

          <div className="row">
            <span>Mod to add files to</span>
            <select
              className="select grow"
              style={{ minWidth: 0 }}
              aria-label="Mod to add files to"
              value={modId}
              onChange={(event) => setModId(event.target.value)}
            >
              <option value="">{mods.length ? 'Choose a mod' : 'No mods yet: create one on the Mods page'}</option>
              {mods.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              title="Put editable copies of the listed files in the chosen mod"
              disabled={busy || !modId || !filter.trim() || shown.length === 0 || shown.length > 200}
              onClick={() => void toMod(shown.map((entry) => entry.path))}
            >
              Add matching to mod
            </button>
          </div>

          <div className="list">
            {shown.slice(0, VISIBLE_ROWS).map((entry) => (
              <div className="list-row" key={entry.path}>
                <div className="list-text grow">
                  <span className="path">{entry.path}</span>
                </div>
                <div className="row">
                  <small className="muted">{formatBytes(entry.sizeBytes)}</small>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void extract([entry.path])}
                  >
                    Extract
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title="Put an editable copy in the mod chosen above"
                    disabled={busy || !modId}
                    onClick={() => void toMod([entry.path])}
                  >
                    To mod
                  </button>
                </div>
              </div>
            ))}
          </div>
          {shown.length > VISIBLE_ROWS && (
            <span className="hint">
              Showing the first {VISIBLE_ROWS} of {shown.length}. Filter by name to narrow the list.
            </span>
          )}

          <span className="hint">
            To change a file, put your edited copy in a mod at{' '}
            <span className="path">files/{selected}/&lt;path shown above&gt;</span> and add the mod
            folder on the Mods page. The launcher merges it into the archive; the original is kept.
          </span>
        </>
      )}
    </div>
  )
}
