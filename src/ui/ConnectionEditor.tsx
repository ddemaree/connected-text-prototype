import { Database, Dices, Plug, RotateCcw, Sparkles, Unlink, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { GENERATOR_KINDS, GENERATOR_UNITS, defaultGeneratorFor } from '../model/generators'
import { bindablePaths, getByPath, resolveOverride, resolveText } from '../model/resolve'
import type {
  DesignDoc,
  FieldIntent,
  GeneratorConfig,
  GeneratorKind,
  NodeId,
  OverrideValue,
  RenderContext,
  TextNode,
} from '../model/types'
import { useStore } from '../store'
import { NumberField, Row, SelectField, TextArea } from './controls'

/** The connected shapes FieldConnection and OverrideValue share. */
type LiveConnection =
  | { type: 'generator'; config: GeneratorConfig }
  | { type: 'binding'; path: string }

type SourceId = 'generator' | 'data'

/**
 * A bindable source. The prototype ships two, but the picker is built from this
 * list rather than from a two-tab assumption — a plugin source slots in here.
 */
interface ConnectionSource {
  id: SourceId
  name: string
  blurb: string
  icon: LucideIcon
}

const SOURCES: ConnectionSource[] = [
  {
    id: 'generator',
    name: 'Generator',
    blurb: 'Dummy text with a chosen shape and length',
    icon: Sparkles,
  },
  {
    id: 'data',
    name: 'Data',
    blurb: 'A path in the JSON data source',
    icon: Database,
  },
]

/**
 * What a ConnectionEditor edits: a text layer's own connection — where the
 * layer must already be designated a field — or one field of a component
 * instance, where the unconnected state is a static override value.
 */
export type ConnectionTarget =
  | { kind: 'node'; node: TextNode }
  | {
      kind: 'override'
      instanceId: NodeId
      fieldName: string
      value: OverrideValue
      /** The definition field's intent, used to seed a generator. */
      intent: FieldIntent
    }

/** Preview `item.*` values against the first item of the enclosing collection. */
export function previewContext(doc: DesignDoc, collectionPath?: string): RenderContext {
  if (!collectionPath) return {}
  const coll = getByPath(doc.data, collectionPath)
  return Array.isArray(coll) && coll.length > 0 ? { item: coll[0], index: 0 } : {}
}

function sourceOf(connection: LiveConnection | null): ConnectionSource | null {
  if (!connection) return null
  const id: SourceId = connection.type === 'generator' ? 'generator' : 'data'
  return SOURCES.find((s) => s.id === id) ?? null
}

/** What the pill says when something is connected: source, then its shape. */
function summaryOf(connection: LiveConnection): string {
  if (connection.type === 'generator') {
    const kind =
      GENERATOR_KINDS.find((k) => k.value === connection.config.kind)?.label ?? connection.config.kind
    return `Generator · ${kind} · ${connection.config.count} ${connection.config.unit}`
  }
  return `Data · ${connection.path || 'choose a path'}`
}

/**
 * A field's connection: one child object, presented as Figma presents a bound
 * variable — a single pill with a popover source picker, its local parameters
 * underneath. Plain text has no connection block at all: designation gates
 * connection.
 */
export function ConnectionEditor({
  target,
  collectionPath,
  compact,
}: {
  target: ConnectionTarget
  /** When inside a collection-bound repeater: the collection path (enables `item.*`). */
  collectionPath?: string
  /** Tighter layout, used by the per-field override list on instances. */
  compact?: boolean
}) {
  const doc = useStore((s) => s.doc)
  const setText = useStore((s) => s.setText)
  const setFieldConnection = useStore((s) => s.setFieldConnection)
  const removeField = useStore((s) => s.removeField)
  const setInstanceOverride = useStore((s) => s.setInstanceOverride)

  const paths = bindablePaths(doc, collectionPath)
  const previewCtx = previewContext(doc, collectionPath)

  const field = target.kind === 'node' ? target.node.field ?? null : null
  const raw = target.kind === 'node' ? field?.connection ?? null : target.value
  const connection: LiveConnection | null =
    raw && (raw.type === 'generator' || raw.type === 'binding') ? raw : null
  const resolved =
    target.kind === 'node'
      ? resolveText(target.node, doc, previewCtx)
      : resolveOverride(target.value, doc, previewCtx)

  const intent = target.kind === 'node' ? field?.intent ?? 'custom' : target.intent
  const generatorKind: GeneratorKind = intent === 'custom' ? 'paragraph' : intent

  /** Both targets accept the connected shapes verbatim. */
  const connect = (value: LiveConnection) => {
    if (target.kind === 'node') setFieldConnection(target.node.id, value)
    else setInstanceOverride(target.instanceId, target.fieldName, value)
  }

  const pick = (id: SourceId) => {
    if (id === 'generator') connect({ type: 'generator', config: defaultGeneratorFor(generatorKind) })
    else connect({ type: 'binding', path: paths[0]?.path ?? '' })
  }

  /** Unlink keeps the designation; the text last shown is baked in. */
  const disconnect = () => {
    if (target.kind === 'node') setFieldConnection(target.node.id, { type: 'none' })
    else
      setInstanceOverride(target.instanceId, target.fieldName, {
        type: 'static',
        value: resolved.missing ? '' : resolved.text,
      })
  }

  // Plain text is just text: the sidebar offers its content and nothing else.
  if (target.kind === 'node' && !field) {
    return (
      <div className="connection-editor">
        <TextArea
          value={target.node.text}
          rows={compact ? 2 : 3}
          placeholder="Text"
          autoSave
          onChange={(v) => setText(target.node.id, v)}
        />
      </div>
    )
  }

  return (
    <div className="connection-editor">
      {target.kind === 'node' && !connection && (
        <>
          <TextArea
            value={target.node.text}
            rows={compact ? 2 : 3}
            placeholder="Placeholder text"
            autoSave
            onChange={(v) => setText(target.node.id, v)}
          />
          <div className="insp-hint">Placeholder — shows until the field is connected.</div>
        </>
      )}

      {target.kind === 'override' && target.value.type === 'static' && (
        <TextArea
          value={target.value.value}
          rows={compact ? 2 : 3}
          autoSave
          onChange={(v) =>
            setInstanceOverride(target.instanceId, target.fieldName, { type: 'static', value: v })
          }
        />
      )}

      <BindingPill connection={connection} onPick={pick} onDisconnect={disconnect} />

      {connection?.type === 'generator' && (
        <div className="connection-params">
          <div className="connection-eyebrow">Generator</div>
          <GeneratorEditor
            config={connection.config}
            onChange={(config) => connect({ type: 'generator', config })}
            preview={compact ? undefined : resolved.text}
          />
        </div>
      )}

      {connection?.type === 'binding' && (
        <div className="connection-params">
          <div className="connection-eyebrow">Data</div>
          <SelectField
            value={connection.path}
            options={[
              ...(paths.some((p) => p.path === connection.path)
                ? []
                : [{ value: connection.path, label: connection.path || '— choose a path —' }]),
              ...paths.map((p) => ({ value: p.path, label: `${p.path}  —  ${p.preview}` })),
            ]}
            onChange={(path) => connect({ type: 'binding', path })}
          />
          <div className={`source-preview ${resolved.missing ? 'is-missing' : ''}`}>
            {resolved.missing ? '⚠ Path not found in data' : resolved.text || '(empty)'}
          </div>
        </div>
      )}

      {target.kind === 'node' && (
        <button
          className="btn btn-remove-field"
          title="Demote to plain text — drops it from the published contract"
          onClick={() => removeField(target.node.id)}
        >
          Remove field
        </button>
      )}

      {target.kind === 'override' && (
        <button
          className="btn btn-detach"
          title="Drop the override and fall back to the component’s default"
          onClick={() => setInstanceOverride(target.instanceId, target.fieldName, null)}
        >
          <RotateCcw size={12} /> Reset
        </button>
      )}
    </div>
  )
}

/**
 * The connection itself, as one object. Empty it invites a source; filled it
 * names the source and offers to unlink. Either way, clicking it opens the
 * same picker — switching sources is not a different gesture from connecting.
 */
function BindingPill({
  connection,
  onPick,
  onDisconnect,
}: {
  connection: LiveConnection | null
  onPick: (id: SourceId) => void
  onDisconnect: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = sourceOf(connection)
  const Icon = current?.icon ?? Plug

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // Capture, and swallow: Escape would otherwise reach the global handler
    // and clear the selection out from under the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="binding-pill-wrap" ref={wrapRef}>
      {connection ? (
        <div className="binding-pill">
          <button
            className="binding-pill-main"
            title="Change the source this field reads from"
            onClick={() => setOpen((v) => !v)}
          >
            <Icon size={12} className="binding-pill-icon" />
            <span className="binding-pill-label">{summaryOf(connection)}</span>
          </button>
          <button
            className="binding-pill-unlink"
            title="Disconnect — keep the field; the text now shown becomes its placeholder"
            onClick={onDisconnect}
          >
            <Unlink size={11} />
          </button>
        </div>
      ) : (
        <button
          className="binding-pill is-empty"
          title="Connect this field to a source"
          onClick={() => setOpen((v) => !v)}
        >
          <Plug size={12} className="binding-pill-icon" />
          <span className="binding-pill-label">Add connection</span>
        </button>
      )}

      {open && (
        <div className="connection-popover" role="menu">
          {SOURCES.map((s) => {
            const RowIcon = s.icon
            return (
              <button
                key={s.id}
                role="menuitem"
                className={`connection-source-row ${current?.id === s.id ? 'is-current' : ''}`}
                onClick={() => {
                  onPick(s.id)
                  setOpen(false)
                }}
              >
                <RowIcon size={13} className="connection-source-icon" />
                <span className="connection-source-name">{s.name}</span>
                <span className="connection-source-blurb">{s.blurb}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GeneratorEditor({
  config,
  onChange,
  preview,
}: {
  config: GeneratorConfig
  onChange: (c: GeneratorConfig) => void
  preview?: string
}) {
  return (
    <div className="generator-editor">
      <Row label="Kind">
        <SelectField
          value={config.kind}
          options={GENERATOR_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          onChange={(kind) => onChange({ ...defaultGeneratorFor(kind), seed: config.seed })}
        />
      </Row>
      <Row label="Length">
        <NumberField value={config.count} min={1} max={2000} onChange={(count) => onChange({ ...config, count })} />
        <SelectField
          value={config.unit}
          options={GENERATOR_UNITS.map((u) => ({ value: u.value, label: u.label }))}
          onChange={(unit) => onChange({ ...config, unit })}
        />
        <button
          className="mini-btn"
          title="Shuffle: regenerate with a new seed"
          onClick={() => onChange({ ...config, seed: Math.floor(Math.random() * 100000) })}
        >
          <Dices size={13} />
        </button>
      </Row>
      {preview !== undefined && <div className="source-preview">{preview}</div>}
    </div>
  )
}
