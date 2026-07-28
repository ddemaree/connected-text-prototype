import { Dices } from 'lucide-react'
import { GENERATOR_KINDS, GENERATOR_UNITS, defaultGeneratorFor } from '../model/generators'
import { bindablePaths, getByPath, resolveContent } from '../model/resolve'
import type { ContentSource, GeneratorConfig, RenderContext } from '../model/types'
import { useStore } from '../store'
import { NumberField, Row, SelectField, Segmented, TextArea } from './controls'

export type SourceKind = 'static' | 'binding' | 'generator' | 'prop'

/**
 * Editor for a ContentSource: static text, JSON data binding, generator, or
 * (inside components) a component prop. Used by the text inspector and, minus
 * the prop option, by instance prop overrides.
 */
export function ContentSourceEditor({
  source,
  onChange,
  collectionPath,
  propNames,
  compact,
}: {
  source: ContentSource
  onChange: (s: ContentSource) => void
  /** When inside a collection-bound repeater: the collection path (enables `item.*`). */
  collectionPath?: string
  /** When inside a component definition: available prop names. */
  propNames?: string[]
  compact?: boolean
}) {
  const doc = useStore((s) => s.doc)
  const paths = bindablePaths(doc, collectionPath)
  // Preview item.* bindings against the collection's first item.
  let previewCtx: RenderContext = {}
  if (collectionPath) {
    const coll = getByPath(doc.data, collectionPath)
    if (Array.isArray(coll) && coll.length > 0) previewCtx = { item: coll[0], index: 0 }
  }
  const resolved = resolveContent(source, doc, previewCtx)

  const switchTo = (kind: SourceKind) => {
    if (kind === source.type) return
    switch (kind) {
      case 'static':
        onChange({ type: 'static', value: resolved.missing ? '' : resolved.text })
        break
      case 'binding':
        onChange({ type: 'binding', path: paths[0]?.path ?? '' })
        break
      case 'generator':
        onChange({ type: 'generator', config: defaultGeneratorFor('paragraph') })
        break
      case 'prop':
        onChange({ type: 'prop', prop: propNames?.[0] ?? '' })
        break
    }
  }

  const kinds: { value: SourceKind; label: string; title: string }[] = [
    { value: 'static', label: 'Static', title: 'Hand-typed text (double-click on canvas to edit)' },
    { value: 'binding', label: 'Data', title: 'Bind to a path in the JSON data source' },
    { value: 'generator', label: 'Generate', title: 'Dummy text with a chosen shape and length' },
  ]
  if (propNames) kinds.push({ value: 'prop', label: 'Prop', title: 'Bind to a component prop' })

  return (
    <div className="content-source-editor">
      <Segmented value={source.type} options={kinds} onChange={switchTo} />

      {source.type === 'static' && !compact && (
        <TextArea value={source.value} onChange={(v) => onChange({ type: 'static', value: v })} rows={3} />
      )}
      {source.type === 'static' && compact && (
        <TextArea value={source.value} onChange={(v) => onChange({ type: 'static', value: v })} rows={2} />
      )}

      {source.type === 'binding' && (
        <>
          <SelectField
            value={source.path}
            options={[
              ...(paths.some((p) => p.path === source.path) ? [] : [{ value: source.path, label: source.path || '— choose a path —' }]),
              ...paths.map((p) => ({ value: p.path, label: `${p.path}  —  ${p.preview}` })),
            ]}
            onChange={(path) => onChange({ type: 'binding', path })}
          />
          <div className={`source-preview ${resolved.missing ? 'is-missing' : ''}`}>
            {resolved.missing ? '⚠ Path not found in data' : resolved.text || '(empty)'}
          </div>
        </>
      )}

      {source.type === 'generator' && (
        <GeneratorEditor
          config={source.config}
          onChange={(config) => onChange({ type: 'generator', config })}
          preview={compact ? undefined : resolved.text}
        />
      )}

      {source.type === 'prop' && propNames && (
        <>
          {propNames.length > 0 ? (
            <SelectField
              value={source.prop}
              options={[
                ...(propNames.includes(source.prop) ? [] : [{ value: source.prop, label: source.prop || '— choose a prop —' }]),
                ...propNames.map((p) => ({ value: p, label: p })),
              ]}
              onChange={(prop) => onChange({ type: 'prop', prop })}
            />
          ) : (
            <div className="source-preview">This component has no props yet — add one below or expose this text.</div>
          )}
        </>
      )}
    </div>
  )
}

export function GeneratorEditor({
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
