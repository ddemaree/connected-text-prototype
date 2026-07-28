import { Check, ChevronRight, Copy, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { connectedComponentSnippet, fetchSnippet, sampleJson, tsInterfaces, typeInterface } from '../model/codegen'
import { componentFields, getByPath, resolveOverride, resolveText } from '../model/resolve'
import {
  deriveSchema,
  describeConstraint,
  describeMigration,
  diffSchema,
  intentLabel,
  type DerivedSchema,
  type SchemaField,
  type SchemaType,
} from '../model/schema'
import type {
  AnyNode,
  DesignDoc,
  FieldConnection,
  InstanceNode,
  NodeId,
  OverrideValue,
  RenderContext,
  TextNode,
} from '../model/types'
import { contentChip } from '../editor/RenderNode'
import { enclosingCollectionPath, useStore } from '../store'
import { Section } from '../ui/controls'

const SOURCE_LABELS: Record<SchemaField['source'], string> = {
  placeholder: 'Placeholder',
  generator: 'Generator',
  binding: 'Data binding',
  mixed: 'Mixed',
}

/** A connection's (or instance override's) point on the ladder, as a label. */
function connectionLabel(c: FieldConnection | OverrideValue): string {
  if (c.type === 'binding') return SOURCE_LABELS.binding
  if (c.type === 'generator') return SOURCE_LABELS.generator
  return SOURCE_LABELS.placeholder // 'none' (unconnected field) or 'static' (instance override)
}

const KIND_LABELS: Record<SchemaType['kind'], string> = {
  collection: 'Collection',
  component: 'Component',
  singleton: 'Singleton',
}

type CodeFormat = 'ts' | 'json' | 'fetch'

const CODE_FORMATS: { value: CodeFormat; label: string }[] = [
  { value: 'ts', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'fetch', label: 'Fetch' },
]

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

/** "4 minutes ago" — publishes are always recent in a prototype session. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'recently'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return ago(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return ago(hours, 'hour')
  return ago(Math.round(hours / 24), 'day')
}

function truncate(s: string, max = 44): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** Click-to-copy with toast feedback, Figma inspect-panel style. */
function useCopy() {
  const setToast = useStore((s) => s.setToast)
  return (value: string, label: string) => {
    const done = navigator.clipboard?.writeText(value)
    if (!done) {
      setToast('Clipboard unavailable in this browser.')
      return
    }
    done.then(() => setToast(`Copied ${label}`)).catch(() => setToast('Could not copy to the clipboard.'))
  }
}

function nodeKind(node: AnyNode): string {
  if (node.type === 'text') return 'Text'
  if (node.type === 'instance') return 'Instance'
  if (node.isComponent) return 'Component'
  if (node.repeat) return 'Repeater'
  return 'Frame'
}

/** The schema type a layer belongs to: its own, its component's, or the one it contributes to. */
function typeForNode(schema: DerivedSchema, node: AnyNode): SchemaType | undefined {
  const direct = schema.types.find((t) => t.sourceId === node.id)
  if (direct) return direct
  if (node.type === 'instance') {
    const component = schema.types.find((t) => t.sourceId === node.componentId)
    if (component) return component
  }
  return schema.types.find((t) => t.fields.some((f) => f.nodeIds.includes(node.id)))
}

/** Resolve an instance's overrides against the first item of its repeater, when it has one. */
function instanceContext(doc: DesignDoc, id: NodeId): RenderContext {
  const path = enclosingCollectionPath(doc, id)
  if (!path) return {}
  const items = getByPath(doc.data, path)
  return Array.isArray(items) && items.length ? { item: items[0], index: 0 } : {}
}

function fieldMeta(field: SchemaField): string {
  return [intentLabel(field.intent), describeConstraint(field.constraint)].filter(Boolean).join(' · ')
}

/** "placeholder · 3 items" (count mode) vs "5 items" (data-bound). */
function collectionCaption(type: SchemaType): string {
  const count = type.itemCount ?? 0
  const items = `${count} item${count === 1 ? '' : 's'}`
  return type.state === 'placeholder' ? `placeholder · ${items}` : items
}

export function DevPanel() {
  const doc = useStore((s) => s.doc)
  const published = useStore((s) => s.publishedSchema)
  const selection = useStore((s) => s.selection)
  const schema = useMemo(() => deriveSchema(doc, published), [doc, published])

  if (selection.length > 1) {
    return (
      <div className="dev-panel">
        <div className="insp-name-row">
          <span className="node-kind-badge kind-dev">Dev</span>
          <span className="dev-node-name">{selection.length} layers</span>
        </div>
        <Section title="Inspect">
          <div className="insp-hint">Select a single layer to read its content contract.</div>
        </Section>
      </div>
    )
  }

  const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  if (!node) return <FileView doc={doc} schema={schema} />
  return <NodeInspector doc={doc} schema={schema} node={node} />
}

function FileView({ doc, schema }: { doc: DesignDoc; schema: DerivedSchema }) {
  const published = useStore((s) => s.publishedSchema)
  const publishCurrentSchema = useStore((s) => s.publishCurrentSchema)
  const select = useStore((s) => s.select)
  const [comparing, setComparing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const migrations = useMemo(() => diffSchema(published, schema), [published, schema])
  const coverage = schema.totalTextCount ? schema.structuredTextCount / schema.totalTextCount : 0

  return (
    <div className="dev-panel">
      <div className="insp-name-row">
        <span className="node-kind-badge kind-dev">Dev</span>
        <span className="dev-node-name">Content schema</span>
      </div>

      <Section title="Publish">
        <div className="dev-publish">
          <div className="dev-publish-line">
            <span className={`dev-dot ${published ? 'is-published' : ''}`} />
            {published ? `Schema v${published.version}` : 'Schema has never been published'}
          </div>
          {published && <div className="dev-publish-sub">published {relativeTime(published.publishedAt)}</div>}
          {migrations.length > 0 ? (
            <button className="dev-drift" onClick={() => setComparing(!comparing)}>
              <ChevronRight size={12} className={`dev-caret ${comparing || confirming ? 'is-open' : ''}`} />
              <span>
                {published
                  ? `${migrations.length} change${migrations.length === 1 ? '' : 's'} since v${published.version}`
                  : `${migrations.length} type${migrations.length === 1 ? '' : 's'} ready to publish`}
              </span>
              <span className="dev-drift-action">Compare changes</span>
            </button>
          ) : (
            <div className="insp-hint">
              {published
                ? 'This file matches the published schema.'
                : 'Nothing to publish yet — mark text layers as content fields first.'}
            </div>
          )}
          {(comparing || confirming) && migrations.length > 0 && (
            <ul className="dev-migrations">
              {migrations.map((m, i) => (
                <li key={`${m.kind}-${i}`} className={`dev-migration is-${m.kind}`}>
                  {describeMigration(m)}
                </li>
              ))}
            </ul>
          )}
          {schema.defaultNamedCount > 0 && (
            <div className="dev-lint" title="A quality gate before publish, not a blocker">
              <span className="dev-lint-dot" />
              {schema.defaultNamedCount} field{schema.defaultNamedCount === 1 ? '' : 's'} still{' '}
              {schema.defaultNamedCount === 1 ? 'has a default name' : 'have default names'}
            </div>
          )}
          {confirming ? (
            <div className="dev-publish-actions">
              <button className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="btn btn-dev"
                onClick={() => {
                  publishCurrentSchema()
                  setConfirming(false)
                  setComparing(false)
                }}
              >
                <Check size={13} /> Publish v{(published?.version ?? 0) + 1}
              </button>
            </div>
          ) : (
            <button className="btn btn-dev" disabled={migrations.length === 0} onClick={() => setConfirming(true)}>
              <UploadCloud size={13} /> Publish schema
            </button>
          )}
        </div>
      </Section>

      <Section title="Types" badge={<span className="dev-caption">{schema.types.length}</span>}>
        <div className="dev-coverage">
          {schema.fieldCount} field{schema.fieldCount === 1 ? '' : 's'} across {schema.types.length} type
          {schema.types.length === 1 ? '' : 's'} · {schema.structuredTextCount} of {schema.totalTextCount} text
          layers structured
        </div>
        <div className="dev-meter">
          <div className="dev-meter-fill" style={{ width: `${Math.round(coverage * 100)}%` }} />
        </div>
        {schema.types.length === 0 && (
          <div className="insp-hint">
            Nothing structured yet — mark text layers as content fields in Design mode (Shift+D).
          </div>
        )}
        {schema.types.map((type) => (
          <div className="dev-type" key={type.key}>
            <button className="dev-type-head" title="Select this layer" onClick={() => select([type.sourceId])}>
              <span className={`node-kind-badge kind-${type.kind}`}>{KIND_LABELS[type.kind]}</span>
              <span className="dev-type-name">{type.name}</span>
              {type.kind === 'collection' && <span className="dev-caption">{collectionCaption(type)}</span>}
            </button>
            <FieldList fields={type.fields} />
          </div>
        ))}
      </Section>

      <CodeSection doc={doc} schema={schema} />
    </div>
  )
}

function NodeInspector({ doc, schema, node }: { doc: DesignDoc; schema: DerivedSchema; node: AnyNode }) {
  const select = useStore((s) => s.select)
  const type = typeForNode(schema, node)
  const kind = nodeKind(node)
  const chip = node.type === 'text' ? contentChip(node) : null

  return (
    <div className="dev-panel">
      <div className="insp-name-row">
        <span className={`node-kind-badge kind-${kind.toLowerCase()}`}>{kind}</span>
        <span className="dev-node-name">{node.name}</span>
        {chip && <span className={`content-chip ${chip.cls}`}>{chip.label}</span>}
      </div>
      {type &&
        (type.sourceId === node.id ? (
          <div className="dev-type-link is-static">
            {KIND_LABELS[type.kind]} · {type.name}
          </div>
        ) : (
          <button className="dev-type-link" title="Select the layer that owns this type" onClick={() => select([type.sourceId])}>
            {KIND_LABELS[type.kind]} · {type.name}
          </button>
        ))}

      {node.type === 'text' && <TextContentSection doc={doc} node={node} type={type} />}
      {node.type === 'instance' && <ConnectedCodeSection doc={doc} node={node} />}
      {node.type === 'frame' && type && <FieldsSection type={type} />}
      {!type && node.type !== 'text' && (
        <Section title="Schema">
          <div className="insp-hint">This layer has no content fields — nothing to publish from it yet.</div>
        </Section>
      )}
      {type && <CodeSection doc={doc} schema={schema} type={type} />}
    </div>
  )
}

function TextContentSection({ doc, node, type }: { doc: DesignDoc; node: TextNode; type?: SchemaType }) {
  const copy = useCopy()
  const field = type?.fields.find((f) => f.nodeIds.includes(node.id))

  if (!node.field) {
    return (
      <Section title="Content">
        <div className="insp-hint">
          Plain text — switch to Design mode (Shift+D) to mark it as a content field.
        </div>
      </Section>
    )
  }

  const connection = node.field.connection
  const rows: { label: string; value: string }[] = []
  rows.push({ label: 'Field', value: node.field.name })
  rows.push({ label: 'Intent', value: intentLabel(field?.intent ?? node.field.intent) })
  const constraint = describeConstraint(field?.constraint ?? node.field.maxLength ?? null)
  if (constraint) rows.push({ label: 'Constraint', value: constraint })
  rows.push({ label: 'Source', value: connectionLabel(connection) })
  if (connection.type === 'binding') rows.push({ label: 'Path', value: connection.path })
  rows.push({ label: 'Type', value: field?.type ?? 'string' })
  rows.push({ label: 'Value', value: field?.sampleValue ?? resolveText(node, doc, {}).text })
  const description = node.field.description?.trim() || field?.description
  if (description) rows.push({ label: 'Description', value: description })

  return (
    <Section title="Content" badge={<span className="dev-caption">click to copy</span>}>
      <div className="dev-list">
        {rows.map((row) => (
          <button
            className="dev-list-row"
            key={row.label}
            title={`Copy ${row.label.toLowerCase()}`}
            onClick={() => copy(row.value, `“${truncate(row.value)}”`)}
          >
            <span className="dev-list-label">{row.label}</span>
            <span className="dev-list-value">{row.value}</span>
            <Copy className="dev-list-copy" size={11} />
          </button>
        ))}
      </div>
      {connection.type === 'none' && (
        <div className="insp-hint">Placeholder — shows until the field is connected. Still part of the published schema.</div>
      )}
    </Section>
  )
}

function ConnectedCodeSection({ doc, node }: { doc: DesignDoc; node: InstanceNode }) {
  const copy = useCopy()
  const snippet = connectedComponentSnippet(doc, node.id)
  const fields = componentFields(doc, node.componentId)
  const ctx = instanceContext(doc, node.id)

  return (
    <>
      <Section title="Connected code">
        {snippet ? (
          <>
            <pre className="dev-code">{snippet}</pre>
            <div className="dev-code-caption">
              via Code Connect
              <button className="mini-btn" title="Copy snippet" onClick={() => copy(snippet, 'the connected snippet')}>
                <Copy size={12} />
              </button>
            </div>
          </>
        ) : (
          <div className="insp-hint">This instance has lost its component definition.</div>
        )}
      </Section>
      <Section title="Fields" badge={<span className="dev-caption">click to copy</span>}>
        {fields.length === 0 && <div className="insp-hint">This component has no fields.</div>}
        <div className="dev-list">
          {fields.map(({ node: defNode, field }) => {
            const override = node.overrides[field.name]
            const value = override ? resolveOverride(override, doc, ctx).text : resolveText(defNode, doc, ctx).text
            return (
              <button
                className="dev-list-row is-prop"
                key={field.name}
                title="Copy value"
                onClick={() => copy(value, `“${truncate(value)}”`)}
              >
                <span className="dev-list-label">{field.name}</span>
                <span className="dev-list-source">{connectionLabel(override ?? field.connection)}</span>
                <span className="dev-list-value">{value}</span>
              </button>
            )
          })}
        </div>
      </Section>
    </>
  )
}

function FieldsSection({ type }: { type: SchemaType }) {
  return (
    <Section title="Fields" badge={type.kind === 'collection' ? <span className="dev-caption">{collectionCaption(type)}</span> : undefined}>
      {type.kind === 'component' && (
        <div className="insp-hint">Fields inside this component are its content API.</div>
      )}
      <FieldList fields={type.fields} />
    </Section>
  )
}

function FieldList({ fields }: { fields: SchemaField[] }) {
  if (fields.length === 0) return <div className="insp-hint">No fields yet.</div>
  return (
    <div className="dev-fields">
      {fields.map((field) => (
        <div className="dev-field" key={field.name}>
          <span className="dev-field-name">{field.name}</span>
          <span className="dev-field-type">{field.type}</span>
          <span className="dev-field-meta">{fieldMeta(field)}</span>
        </div>
      ))}
    </div>
  )
}

function CodeSection({ doc, schema, type }: { doc: DesignDoc; schema: DerivedSchema; type?: SchemaType }) {
  const copy = useCopy()
  const [format, setFormat] = useState<CodeFormat>('ts')
  const code = useMemo(() => {
    const scoped: DerivedSchema = type ? { ...schema, types: [type] } : schema
    switch (format) {
      case 'json':
        return sampleJson(scoped, doc)
      case 'fetch':
        return scoped.types.map(fetchSnippet).join('\n\n') || '// No types to fetch yet.'
      case 'ts':
        return type ? typeInterface(type) : tsInterfaces(schema)
    }
  }, [doc, format, schema, type])

  return (
    <Section
      title="Code"
      badge={
        <div className="dev-code-tools">
          <select
            className="field select-field dev-format"
            value={format}
            title="Code format"
            onChange={(e) => setFormat(e.target.value as CodeFormat)}
          >
            {CODE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="mini-btn" title="Copy code" onClick={() => copy(code, 'the code snippet')}>
            <Copy size={12} />
          </button>
        </div>
      }
    >
      <pre className="dev-code">{code}</pre>
    </Section>
  )
}
