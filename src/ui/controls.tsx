import { useEffect, useState, type ReactNode } from 'react'

export function Section({ title, children, badge }: { title: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="insp-section">
      <div className="insp-section-title">
        {title}
        {badge}
      </div>
      {children}
    </div>
  )
}

export function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="insp-row">
      {label !== undefined && <div className="insp-label">{label}</div>}
      <div className="insp-control">{children}</div>
    </div>
  )
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  title,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  title?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = parseFloat(text)
    if (!Number.isNaN(n)) {
      let v = n
      if (min !== undefined) v = Math.max(min, v)
      if (max !== undefined) v = Math.min(max, v)
      onChange(v)
      setText(String(v))
    } else {
      setText(String(value))
    }
  }
  return (
    <input
      className="field number-field"
      type="number"
      value={text}
      step={step}
      disabled={disabled}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className="field"
      type="text"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <textarea
      className="field textarea-field"
      rows={rows}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
    />
  )
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <select className="field select-field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={`segmented-btn ${o.value === value ? 'active' : ''}`}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorField({
  value,
  onChange,
  allowNone,
}: {
  value: string | null
  onChange: (v: string | null) => void
  allowNone?: boolean
}) {
  return (
    <div className="color-field">
      <input
        type="color"
        value={value ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="color-swatch"
      />
      <span className="color-value">{value ?? 'None'}</span>
      {allowNone && (
        <button className="mini-btn" title={value ? 'Remove' : 'Add'} onClick={() => onChange(value ? null : '#ffffff')}>
          {value ? '−' : '+'}
        </button>
      )}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
