import { Dices, RotateCcw, Unlink } from 'lucide-react'
import { GENERATOR_KINDS, GENERATOR_UNITS, defaultGeneratorFor } from '../model/generators'
import { bindablePaths, getByPath, resolveOverride, resolveText } from '../model/resolve'
import type {
  DesignDoc,
  FieldConnection,
  FieldIntent,
  GeneratorConfig,
  GeneratorKind,
  NodeId,
  OverrideValue,
  RenderContext,
  TextNode,
} from '../model/types'
import { useStore } from '../store'
import { NumberField, Row, SelectField, Segmented, TextArea } from './controls'

/** One rung of the connection ladder, as a segmented-control value. */
type Rung = 'value' | 'generate' | 'data'

/** The connected rungs — the two shapes FieldConnection and OverrideValue share. */
type LiveConnection =
  | { type: 'generator'; config: GeneratorConfig }
  | { type: 'binding'; path: string }

/**
 * What a ConnectionEditor edits: a text layer's own connection — where the
 * bottom rung is the layer's literal text and connecting auto-promotes it to a
 * field — or one field of a component instance, where the bottom rung is a
 * static override value.
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

function rungOf(connection: FieldConnection | OverrideValue | null): Rung {
  if (connection?.type === 'generator') return 'generate'
  if (connection?.type === 'binding') return 'data'
  return 'value'
}

/**
 * The one connection spectrum: placeholder → generator → bound. The options
 * depend on the target's state, because the bottom rung means something
 * different for plain text (static), a field (placeholder) and an instance
 * override (static value).
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
  const connection = target.kind === 'node' ? field?.connection ?? null : target.value
  const rung = rungOf(connection)
  const resolved =
    target.kind === 'node'
      ? resolveText(target.node, doc, previewCtx)
      : resolveOverride(target.value, doc, previewCtx)

  const intent = target.kind === 'node' ? field?.intent ?? 'custom' : target.intent
  const generatorKind: GeneratorKind = intent === 'custom' ? 'paragraph' : intent

  /** Both targets accept the connected rungs verbatim. */
  const connect = (value: LiveConnection) => {
    if (target.kind === 'node') setFieldConnection(target.node.id, value)
    else setInstanceOverride(target.instanceId, target.fieldName, value)
  }

  const switchTo = (next: Rung) => {
    if (next === rung) return
    if (next === 'generate') {
      connect({ type: 'generator', config: defaultGeneratorFor(generatorKind) })
      return
    }
    if (next === 'data') {
      connect({ type: 'binding', path: paths[0]?.path ?? '' })
      return
    }
    // Down to the bottom rung: the field keeps its designation, the override
    // keeps the text it was showing.
    if (target.kind === 'node') setFieldConnection(target.node.id, { type: 'none' })
    else {
      setInstanceOverride(target.instanceId, target.fieldName, {
        type: 'static',
        value: resolved.missing ? '' : resolved.text,
      })
    }
  }

  const options: { value: Rung; label: string; title: string }[] = [
    field
      ? { value: 'value', label: 'Placeholder', title: 'Unconnected — the layer’s own text is the sample value' }
      : { value: 'value', label: 'Static', title: 'Hand-typed text (double-click on canvas to edit)' },
    { value: 'generate', label: 'Generate', title: 'Dummy text with a chosen shape and length' },
    { value: 'data', label: 'Data', title: 'Bind to a path in the JSON data source' },
  ]

  return (
    <div className="connection-editor">
      <Segmented value={rung} options={options} onChange={switchTo} />

      {target.kind === 'node' && !field && (
        <div className="insp-hint">Connecting text marks it as a content field.</div>
      )}

      {rung === 'value' && target.kind === 'node' && (
        <>
          <TextArea
            value={target.node.text}
            rows={compact ? 2 : 3}
            placeholder={field ? 'Placeholder text' : 'Text'}
            autoSave
            onChange={(v) => setText(target.node.id, v)}
          />
          {field && (
            <div className="insp-hint">Placeholder — shows until the field is connected.</div>
          )}
        </>
      )}

      {rung === 'value' && target.kind === 'override' && target.value.type === 'static' && (
        <TextArea
          value={target.value.value}
          rows={compact ? 2 : 3}
          autoSave
          onChange={(v) =>
            setInstanceOverride(target.instanceId, target.fieldName, { type: 'static', value: v })
          }
        />
      )}

      {connection?.type === 'binding' && (
        <>
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
        </>
      )}

      {connection?.type === 'generator' && (
        <GeneratorEditor
          config={connection.config}
          onChange={(config) => connect({ type: 'generator', config })}
          preview={compact ? undefined : resolved.text}
        />
      )}

      {target.kind === 'node' && field && field.connection.type !== 'none' && (
        <button
          className="btn btn-detach"
          title="Drop the connection, keep the field — the text now shown becomes its placeholder"
          onClick={() => setFieldConnection(target.node.id, { type: 'none' })}
        >
          <Unlink size={12} /> Disconnect
        </button>
      )}

      {target.kind === 'node' && field && (
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
