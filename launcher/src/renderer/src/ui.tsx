import { useEffect, useState, type ReactNode } from 'react'

export type Notify = (message: string, kind?: 'info' | 'error') => void

const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  settings:
    'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4',
  saves: 'M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7',
  dlc: 'M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5 12 12l9-4.5M12 12v9',
  mods: 'M14 4l6 6-9.5 9.5H4.5V13.5zM12 6l6 6',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  play: 'M7 4.5v15l12-7.5z'
} as const

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const filled = name === 'play'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </header>
  )
}

export function Toggle(props: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className="toggle"
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  )
}

/** A destructive action that asks once more before it runs. */
export function ConfirmButton(props: {
  label: string
  confirmLabel: string
  disabled?: boolean
  danger?: boolean
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <button
      type="button"
      disabled={props.disabled}
      className={`btn ${armed ? (props.danger ? 'btn-danger' : 'btn-primary') : 'btn-ghost'}`}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) props.onConfirm()
        setArmed(!armed)
      }}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  )
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{props.title}</strong>
      {props.children && <p>{props.children}</p>}
    </div>
  )
}

export const fileName = (path: string | null): string => path?.split(/[\\/]/).pop() ?? ''

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${units[unit]}`
}
