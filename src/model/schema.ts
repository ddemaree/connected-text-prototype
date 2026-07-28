import { GENERATOR_KINDS } from './generators'
import { componentFields, getByPath, resolveOverride, resolveText } from './resolve'
import {
  DEFAULT_FIELD_NAME_RE,
  newId,
  type AnyNode,
  type DesignDoc,
  type FieldConnection,
  type FieldIntent,
  type FrameNode,
  type GeneratorUnit,
  type NodeId,
  type OverrideValue,
  type RenderContext,
  type TextField,
  type TextNode,
} from './types'

export interface SchemaField {
  /** Stable id once published, else null. */
  id: string | null
  name: string
  intent: FieldIntent
  type: 'string' | 'number' | 'boolean'
  description?: string
  constraint?: { unit: GeneratorUnit; count: number } | null
  /** Where the field's value comes from — its point on the connection ladder. */
  source: 'placeholder' | 'generator' | 'binding' | 'mixed'
  bindingPath?: string
  /** Still carrying an auto-assigned name (text_field_N) — contract hygiene lint. */
  defaultNamed: boolean
  /** Text (or instance) nodes that contribute this field. */
  nodeIds: NodeId[]
  /** Resolved current text of the first contributor. */
  sampleValue: string
}

export interface SchemaType {
  /** Slug, unique within the schema. */
  key: string
  name: string
  kind: 'collection' | 'component' | 'singleton'
  /** Repeater frame / component definition / top-level frame. */
  sourceId: NodeId
  /** Collections only: resolved item count. */
  itemCount?: number
  /** Collections only: bound to data, or a count-mode placeholder. */
  state?: 'bound' | 'placeholder'
  fields: SchemaField[]
}

export interface DerivedSchema {
  types: SchemaType[]
  /** Fields across all types — the size of the contract. */
  fieldCount: number
  /** Fields still named text_field_N. */
  defaultNamedCount: number
  /** Text nodes designated as fields. */
  structuredTextCount: number
  totalTextCount: number
}

export interface PublishedField {
  id: string
  name: string
  intent: FieldIntent
  type: SchemaField['type']
  description?: string
  constraint?: SchemaField['constraint']
  /** Contributors at publish time — used to detect renames. */
  nodeIds: NodeId[]
}

export interface PublishedType {
  key: string
  name: string
  kind: SchemaType['kind']
  fields: PublishedField[]
}

export interface PublishedSchema {
  version: number
  /** ISO timestamp. */
  publishedAt: string
  types: PublishedType[]
}

export type SchemaMigration =
  | { kind: 'add-type'; type: string }
  | { kind: 'remove-type'; type: string }
  | { kind: 'add-field'; type: string; field: string }
  | { kind: 'remove-field'; type: string; field: string }
  | { kind: 'rename-field'; type: string; from: string; to: string }
  | { kind: 'retype-field'; type: string; field: string; from: string; to: string }
  | { kind: 'constraint-change'; type: string; field: string }

export const FIELD_INTENTS: { value: FieldIntent; label: string }[] = [
  ...GENERATOR_KINDS,
  { value: 'custom', label: 'Custom' },
]

export function intentLabel(intent: FieldIntent): string {
  return FIELD_INTENTS.find((i) => i.value === intent)?.label ?? 'Custom'
}

/** "max 20 words" / "max 1 word" — empty string when unconstrained. */
export function describeConstraint(c: SchemaField['constraint']): string {
  if (!c) return ''
  const unit = c.count === 1 ? c.unit.replace(/s$/, '') : c.unit
  return `max ${c.count} ${unit}`
}

/** Lowercase slug: alphanumerics joined by dashes. */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "article card" → "Article Card" */
export function titleCase(s: string): string {
  const words = s.replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Last non-numeric segment of a path: "articles[0].title" → "title". */
export function pathLeaf(path: string): string {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  while (segments.length && /^\d+$/.test(segments[segments.length - 1])) segments.pop()
  const last = segments[segments.length - 1] ?? ''
  return last === 'item' ? '' : last
}

function inferType(v: unknown): SchemaField['type'] | null {
  if (typeof v === 'string') return 'string'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  return null
}

function documentOrder(doc: DesignDoc): NodeId[] {
  const out: NodeId[] = []
  const visit = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    out.push(id)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  doc.rootIds.forEach(visit)
  return out
}

function subtree(doc: DesignDoc, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const visit = (nid: NodeId) => {
    const node = doc.nodes[nid]
    if (!node) return
    out.push(nid)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  visit(id)
  return out
}

/**
 * The nearest enclosing thing that owns a node's fields: a component
 * definition, or the template child of a repeater. Everything else belongs to
 * its root frame's singleton.
 */
export function fieldOwner(
  doc: DesignDoc,
  id: NodeId,
): { kind: 'collection' | 'component'; id: NodeId } | null {
  let child: AnyNode | null = null
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur) {
    if (cur.type === 'frame' && cur.isComponent) return { kind: 'component', id: cur.id }
    if (cur.type === 'frame' && cur.repeat && child && cur.children[0] === child.id) {
      return { kind: 'collection', id: cur.id }
    }
    child = cur
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined
  }
  return null
}

function rootOf(doc: DesignDoc, id: NodeId): AnyNode | undefined {
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur?.parentId) {
    const parent: AnyNode | undefined = doc.nodes[cur.parentId]
    if (!parent) break
    cur = parent
  }
  return cur
}

/** One text/instance node's take on a field, before same-name merging. */
interface Contribution {
  name: string
  intent: FieldIntent
  type: SchemaField['type']
  description?: string
  constraint?: { unit: GeneratorUnit; count: number } | null
  source: SchemaField['source']
  bindingPath?: string
  defaultNamed: boolean
  nodeIds: NodeId[]
  sampleValue: string
}

interface TypeDraft {
  key: string
  name: string
  kind: SchemaType['kind']
  sourceId: NodeId
  itemCount?: number
  state?: SchemaType['state']
  contributions: Contribution[]
}

/** A connection (or an instance override) reduced to its schema source string. */
function sourceOf(c: FieldConnection | OverrideValue): SchemaField['source'] {
  if (c.type === 'binding') return 'binding'
  if (c.type === 'generator') return 'generator'
  return 'placeholder'
}

function bindingOf(c: FieldConnection | OverrideValue): string | undefined {
  return c.type === 'binding' ? c.path : undefined
}

/** Field metadata (name/intent/description/constraint) shared by every code path. */
function baseContribution(field: TextField, nodeId: NodeId): Contribution {
  const contribution: Contribution = {
    name: field.name,
    intent: field.intent,
    type: 'string',
    source: 'placeholder',
    defaultNamed: DEFAULT_FIELD_NAME_RE.test(field.name),
    nodeIds: [nodeId],
    sampleValue: '',
  }
  const description = field.description?.trim()
  if (description) contribution.description = description
  if (field.maxLength) contribution.constraint = { ...field.maxLength }
  return contribution
}

function contributionFromText(node: TextNode, field: TextField, doc: DesignDoc, ctx: RenderContext): Contribution {
  const contribution = baseContribution(field, node.id)
  contribution.source = sourceOf(field.connection)
  contribution.bindingPath = bindingOf(field.connection)
  contribution.sampleValue = resolveText(node, doc, ctx).text
  if (contribution.bindingPath) {
    contribution.type = inferType(getByPath(doc.data, contribution.bindingPath, ctx)) ?? 'string'
  }
  return contribution
}

/**
 * A collection type for any repeater whose template carries fields. Bound
 * repeaters name themselves from the data path; count-mode ones are the
 * repeater's placeholder state — dummy cardinality, real field list.
 */
function collectionDraft(doc: DesignDoc, frame: FrameNode): TypeDraft | null {
  const repeat = frame.repeat
  if (!repeat) return null
  const templateId = frame.children[0]
  if (!templateId) return null

  const bound = repeat.mode === 'collection'
  const raw = bound ? getByPath(doc.data, repeat.path) : undefined
  const items = Array.isArray(raw) ? raw : []
  const firstItem = items[0]
  const ctx: RenderContext = { item: firstItem, index: 0 }
  const label = (bound ? pathLeaf(repeat.path) : '') || slugify(frame.name) || 'items'

  const draft: TypeDraft = {
    key: slugify(label) || 'items',
    name: titleCase(label) || frame.name,
    kind: 'collection',
    sourceId: frame.id,
    itemCount: bound ? items.length : repeat.count,
    state: bound ? 'bound' : 'placeholder',
    contributions: [],
  }

  const typeOf = (bindingPath: string | undefined, name: string): SchemaField['type'] => {
    if (!bound) return 'string'
    const value = bindingPath ? getByPath(doc.data, bindingPath, ctx) : getByPath(firstItem, name)
    return inferType(value) ?? 'string'
  }

  for (const id of subtree(doc, templateId)) {
    const node = doc.nodes[id]
    if (!node) continue
    const owner = fieldOwner(doc, id)
    if (owner?.kind !== 'collection' || owner.id !== frame.id) continue

    if (node.type === 'text' && node.field) {
      const contribution = contributionFromText(node, node.field, doc, ctx)
      contribution.type = typeOf(contribution.bindingPath, contribution.name)
      draft.contributions.push(contribution)
      continue
    }

    if (node.type === 'instance') {
      // An instance template exposes the definition's fields; the instance's
      // overrides say how each one is wired for this collection.
      for (const { node: defNode, field } of componentFields(doc, node.componentId)) {
        const override = node.overrides[field.name]
        const contribution = baseContribution(field, node.id)
        contribution.source = sourceOf(override ?? field.connection)
        contribution.bindingPath = bindingOf(override ?? field.connection)
        contribution.sampleValue = override
          ? resolveOverride(override, doc, ctx).text
          : resolveText(defNode, doc, ctx).text
        contribution.type = typeOf(contribution.bindingPath, contribution.name)
        draft.contributions.push(contribution)
      }
    }
  }

  return draft.contributions.length ? draft : null
}

/** A component's fields ARE its content API; the definition supplies defaults. */
function componentDraft(doc: DesignDoc, frame: FrameNode): TypeDraft {
  const draft: TypeDraft = {
    key: slugify(frame.name) || 'component',
    name: titleCase(frame.name) || frame.name,
    kind: 'component',
    sourceId: frame.id,
    contributions: [],
  }
  for (const { node, field } of componentFields(doc, frame.id)) {
    draft.contributions.push(contributionFromText(node, field, doc, {}))
  }
  return draft
}

function mergeContributions(contributions: Contribution[]): SchemaField[] {
  const byName = new Map<string, SchemaField>()
  for (const c of contributions) {
    const existing = byName.get(c.name)
    if (!existing) {
      byName.set(c.name, {
        id: null,
        name: c.name,
        intent: c.intent,
        type: c.type,
        description: c.description,
        constraint: c.constraint ?? null,
        source: c.source,
        bindingPath: c.bindingPath,
        defaultNamed: c.defaultNamed,
        nodeIds: [...c.nodeIds],
        sampleValue: c.sampleValue,
      })
      continue
    }
    for (const id of c.nodeIds) if (!existing.nodeIds.includes(id)) existing.nodeIds.push(id)
    if (existing.source !== c.source) existing.source = 'mixed'
    if (existing.intent === 'custom' && c.intent !== 'custom') existing.intent = c.intent
    if (!existing.description && c.description) existing.description = c.description
    if (!existing.constraint && c.constraint) existing.constraint = c.constraint
    if (!existing.bindingPath && c.bindingPath) existing.bindingPath = c.bindingPath
    if (!existing.sampleValue && c.sampleValue) existing.sampleValue = c.sampleValue
  }
  return [...byName.values()]
}

function uniqueKey(base: string, used: Set<string>): string {
  const stem = base || 'type'
  let key = stem
  let n = 2
  while (used.has(key)) key = `${stem}-${n++}`
  used.add(key)
  return key
}

/** Carry ids over from the published schema: by name first, then by contributor overlap (a rename). */
function applyPublishedIds(types: SchemaType[], published: PublishedSchema | null) {
  if (!published) return
  for (const type of types) {
    const prev = published.types.find((t) => t.key === type.key)
    if (!prev) continue
    const claimed = new Set(type.fields.map((f) => f.id).filter((id): id is string => !!id))
    for (const field of type.fields) {
      if (field.id) continue
      const match = prev.fields.find((f) => f.name === field.name && !claimed.has(f.id))
      if (match) {
        field.id = match.id
        claimed.add(match.id)
      }
    }
    for (const field of type.fields) {
      if (field.id) continue
      const match = prev.fields.find(
        (f) => !claimed.has(f.id) && f.nodeIds.some((n) => field.nodeIds.includes(n)),
      )
      if (match) {
        field.id = match.id
        claimed.add(match.id)
      }
    }
  }
}

/**
 * Derive the content schema from the document. The contract is exactly the set
 * of designations: repeaters with fields become collections, component
 * definitions become component types, and every other field groups into its
 * root frame's singleton. Nothing is inferred from layer names.
 */
export function deriveSchema(doc: DesignDoc, published: PublishedSchema | null): DerivedSchema {
  const order = documentOrder(doc)
  const collections: TypeDraft[] = []
  const components: TypeDraft[] = []
  const singletons: TypeDraft[] = []
  const singletonByRoot = new Map<NodeId, TypeDraft>()

  for (const id of order) {
    const node = doc.nodes[id]
    if (node?.type !== 'frame') continue
    if (node.repeat) {
      const draft = collectionDraft(doc, node)
      if (draft) collections.push(draft)
    }
    if (node.isComponent) components.push(componentDraft(doc, node))
  }

  let totalTextCount = 0
  let structuredTextCount = 0
  for (const id of order) {
    const node = doc.nodes[id]
    if (node?.type !== 'text') continue
    totalTextCount += 1
    if (!node.field) continue
    structuredTextCount += 1
    if (fieldOwner(doc, id)) continue

    const root = rootOf(doc, id)
    if (!root) continue
    let draft = singletonByRoot.get(root.id)
    if (!draft) {
      draft = {
        key: slugify(root.name) || 'section',
        name: titleCase(root.name) || root.name,
        kind: 'singleton',
        sourceId: root.id,
        contributions: [],
      }
      singletonByRoot.set(root.id, draft)
      singletons.push(draft)
    }
    draft.contributions.push(contributionFromText(node, node.field, doc, {}))
  }

  const usedKeys = new Set<string>()
  const types: SchemaType[] = []
  for (const draft of [...collections, ...components, ...singletons]) {
    const fields = mergeContributions(draft.contributions)
    if (draft.kind === 'singleton' && fields.length === 0) continue
    const type: SchemaType = {
      key: uniqueKey(draft.key, usedKeys),
      name: draft.name,
      kind: draft.kind,
      sourceId: draft.sourceId,
      fields,
    }
    if (draft.kind === 'collection') {
      type.itemCount = draft.itemCount ?? 0
      type.state = draft.state
    }
    types.push(type)
  }

  applyPublishedIds(types, published)
  const fieldCount = types.reduce((n, t) => n + t.fields.length, 0)
  const defaultNamedCount = types.reduce(
    (n, t) => n + t.fields.filter((f) => f.defaultNamed).length,
    0,
  )
  return { types, fieldCount, defaultNamedCount, structuredTextCount, totalTextCount }
}

function sameConstraint(a: SchemaField['constraint'], b: SchemaField['constraint']): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.unit === b.unit && a.count === b.count
}

/** Migrations needed to go from the published schema to the current derived one. */
export function diffSchema(prev: PublishedSchema | null, next: DerivedSchema): SchemaMigration[] {
  const out: SchemaMigration[] = []
  if (!prev) {
    for (const type of next.types) out.push({ kind: 'add-type', type: type.key })
    return out
  }

  const nextKeys = new Set(next.types.map((t) => t.key))
  for (const type of next.types) {
    const before = prev.types.find((t) => t.key === type.key)
    if (!before) {
      out.push({ kind: 'add-type', type: type.key })
      continue
    }
    const claimed = new Set<string>()
    for (const field of type.fields) {
      const match =
        (field.id ? before.fields.find((f) => f.id === field.id) : undefined) ??
        before.fields.find((f) => f.name === field.name && !claimed.has(f.id))
      if (!match) {
        out.push({ kind: 'add-field', type: type.key, field: field.name })
        continue
      }
      claimed.add(match.id)
      if (match.name !== field.name) {
        out.push({ kind: 'rename-field', type: type.key, from: match.name, to: field.name })
      }
      if (match.type !== field.type) {
        out.push({ kind: 'retype-field', type: type.key, field: field.name, from: match.type, to: field.type })
      }
      if (!sameConstraint(match.constraint, field.constraint)) {
        out.push({ kind: 'constraint-change', type: type.key, field: field.name })
      }
    }
    for (const field of before.fields) {
      if (!claimed.has(field.id)) out.push({ kind: 'remove-field', type: type.key, field: field.name })
    }
  }
  for (const type of prev.types) {
    if (!nextKeys.has(type.key)) out.push({ kind: 'remove-type', type: type.key })
  }
  return out
}

/** Freeze the derived schema as a new version, keeping field ids stable across renames. */
export function publishSchema(prev: PublishedSchema | null, next: DerivedSchema): PublishedSchema {
  const resolved: SchemaType[] = next.types.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f })) }))
  applyPublishedIds(resolved, prev)
  return {
    version: (prev?.version ?? 0) + 1,
    publishedAt: new Date().toISOString(),
    types: resolved.map((type) => ({
      key: type.key,
      name: type.name,
      kind: type.kind,
      fields: type.fields.map((field) => ({
        id: field.id ?? newId('fld'),
        name: field.name,
        intent: field.intent,
        type: field.type,
        description: field.description,
        constraint: field.constraint ?? null,
        nodeIds: [...field.nodeIds],
      })),
    })),
  }
}

export function describeMigration(m: SchemaMigration): string {
  switch (m.kind) {
    case 'add-type':
      return `Added type “${m.type}”`
    case 'remove-type':
      return `Removed type “${m.type}”`
    case 'add-field':
      return `Added field “${m.field}” to “${m.type}”`
    case 'remove-field':
      return `Removed field “${m.field}” from “${m.type}”`
    case 'rename-field':
      return `Renamed “${m.from}” → “${m.to}” in “${m.type}”`
    case 'retype-field':
      return `Changed “${m.field}” from ${m.from} to ${m.to} in “${m.type}”`
    case 'constraint-change':
      return `Changed the constraint on “${m.field}” in “${m.type}”`
  }
}
