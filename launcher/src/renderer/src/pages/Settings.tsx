import { useEffect, useState } from 'react'
import type { GameStatus, InstallProgress, SettingValue, SettingValues } from '@shared/types'
import { SETTING_SECTIONS, type SettingDef } from '@shared/settingsSchema'
import { PageHeader, Toggle, type Notify } from '../ui'
import { LauncherSettings } from './LauncherSettings'

interface Props {
  status: GameStatus
  setStatus: (status: GameStatus) => void
  notify: Notify
  progress: InstallProgress | null
}

const LAUNCHER_TAB = 'launcher'

export function Settings({ status, setStatus, notify, progress }: Props) {
  const [values, setValues] = useState<SettingValues | null>(null)
  const [section, setSection] = useState(LAUNCHER_TAB)

  // Reload when the game exits: it may have saved its own changes.
  useEffect(() => {
    void window.skate.readSettings().then(setValues)
  }, [status.running])

  if (!values) return <div className="page" />

  const change = async (def: SettingDef, value: SettingValue): Promise<void> => {
    const changes: SettingValues = { [def.key]: value }
    for (const mirror of def.mirrors ?? []) changes[mirror] = value
    setValues({ ...values, ...changes })
    const result = await window.skate.writeSettings(changes)
    if (!result.ok) {
      notify(result.error ?? 'Could not save settings.', 'error')
      setValues(await window.skate.readSettings())
    }
  }

  const active = SETTING_SECTIONS.find((item) => item.id === section)
  const visible =
    active?.settings.filter((def) => !def.windowsOnly || status.platform === 'win32') ?? []

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle={
          active
            ? "The same settings as the in-game menu, saved to the game's settings file."
            : 'How the launcher installs and starts the game.'
        }
      />
      {active && status.running && (
        <div className="notice">
          Skate 3 is running. Change settings from the in-game menu, or close the game to edit them
          here.
        </div>
      )}

      <div className="tabs" role="tablist">
        {[{ id: LAUNCHER_TAB, title: 'Launcher' }, ...SETTING_SECTIONS].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === section}
            className={`tab ${item.id === section ? 'active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {active ? (
        <div className="list">
          {visible.map((def) => (
            <div className="list-row" key={def.key}>
              <div className="list-text">
                <span>{def.label}</span>
                {def.hint && <small>{def.hint}</small>}
              </div>
              <Control
                def={def}
                value={values[def.key] ?? def.default}
                disabled={status.running}
                onChange={(value) => void change(def, value)}
              />
            </div>
          ))}
        </div>
      ) : (
        <LauncherSettings
          status={status}
          setStatus={setStatus}
          notify={notify}
          progress={progress}
        />
      )}
    </div>
  )
}

function Control(props: {
  def: SettingDef
  value: SettingValue
  disabled: boolean
  onChange: (value: SettingValue) => void
}) {
  const { def, value, disabled, onChange } = props

  if (def.choices) {
    const index = def.choices.findIndex((choice) => choice.value === value)
    return (
      <select
        className="select"
        aria-label={def.label}
        disabled={disabled}
        value={index}
        onChange={(event) => onChange(def.choices![Number(event.target.value)].value)}
      >
        {index < 0 && <option value={-1}>Custom ({String(value)})</option>}
        {def.choices.map((choice, i) => (
          <option key={String(choice.value)} value={i}>
            {choice.label}
          </option>
        ))}
      </select>
    )
  }

  if (def.type === 'bool') {
    return (
      <Toggle label={def.label} checked={value === true} disabled={disabled} onChange={onChange} />
    )
  }

  return (
    <Slider
      def={def}
      value={typeof value === 'number' ? value : Number(def.default)}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

/** Shows the value while dragging and saves once on release. */
function Slider(props: {
  def: SettingDef
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const { def, value, disabled, onChange } = props
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft !== value) onChange(draft)
  }

  return (
    <div className="slider">
      <input
        type="range"
        aria-label={def.label}
        disabled={disabled}
        min={def.min}
        max={def.max}
        step={def.step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{Number.isInteger(def.step) ? draft : draft.toFixed(1)}</output>
    </div>
  )
}
