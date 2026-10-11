import type { SettingValue, SettingValues } from '@shared/types'
import type { SettingType } from '@shared/settingsSchema'

// The game's settings.toml is a flat list of `key = value` lines, so a line
// editor is enough and leaves every key the launcher does not know untouched.

const KEY_LINE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/
const TABLE_HEADER = /^\s*\[/

function parseValue(raw: string): SettingValue | undefined {
  const text = raw.trim()
  if (text.startsWith('"')) {
    let out = ''
    for (let i = 1; i < text.length; i++) {
      const c = text[i]
      if (c === '\\' && i + 1 < text.length) {
        const next = text[++i]
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next
      } else if (c === '"') {
        return out
      } else {
        out += c
      }
    }
    return undefined
  }
  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1)
    return end < 0 ? undefined : text.slice(1, end)
  }
  const bare = text.split('#')[0].trim()
  if (bare === 'true') return true
  if (bare === 'false') return false
  if (bare === '') return undefined
  const num = Number(bare.replace(/_/g, ''))
  return Number.isFinite(num) ? num : undefined
}

export function parseFlatToml(text: string): SettingValues {
  const values: SettingValues = {}
  for (const line of text.split(/\r?\n/)) {
    if (TABLE_HEADER.test(line)) break
    const match = KEY_LINE.exec(line)
    if (!match) continue
    const value = parseValue(match[2])
    if (value !== undefined) values[match[1]] = value
  }
  return values
}

/** Returns the TOML literal for a value, or null when it does not fit the type. */
export function formatValue(value: SettingValue, type: SettingType): string | null {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean' ? String(value) : null
    case 'string':
      return typeof value === 'string' ? JSON.stringify(value) : null
    case 'int':
      return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : null
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      // Keep a decimal point so the value stays a TOML float.
      return Number.isInteger(value) ? value.toFixed(1) : String(value)
  }
}

/** Rewrites `key = literal` lines in place and adds the keys that are missing. */
export function updateFlatToml(text: string, literals: Map<string, string>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text === '' ? [] : text.split(/\r?\n/)
  const pending = new Map(literals)

  let topLevelEnd = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (TABLE_HEADER.test(lines[i])) {
      topLevelEnd = i
      break
    }
    const match = KEY_LINE.exec(lines[i])
    const literal = match && pending.get(match[1])
    if (match && literal !== undefined && literal !== null) {
      lines[i] = `${match[1]} = ${literal}`
      pending.delete(match[1])
    }
  }

  // New keys go at the end of the top-level section, above any trailing blank lines.
  let insertAt = topLevelEnd
  while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--
  const added = [...pending].map(([key, literal]) => `${key} = ${literal}`)
  lines.splice(insertAt, 0, ...added)

  const out = lines.join(eol)
  return out.endsWith(eol) ? out : out + eol
}
