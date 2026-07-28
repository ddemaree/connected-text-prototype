import { GENERATOR_KINDS } from './generators'
import { getByPath, resolveContent } from './resolve'
import {
  newId,
  type AnyNode,
  type ContentSource,
  type DesignDoc,
  type FieldIntent,
  type FieldMeta,
  type FrameNode,
  type GeneratorUnit,
  type NodeId,
  type RenderContext,
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
  source: 'static' | 'binding' | 'generator' | 'prop' | 'mixed'
  bindingPath?: string
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
  fields: SchemaField[]
}

export interface DerivedSchema {
  types: SchemaType[]
  /** Text nodes that are annotated or non-static. */
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

function isItemPath(path: string): boolean {
  const p = path.trim()
  return p === 'item' || p.startsWith('item.') || p.startsWith('item[')
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
 * The nearest enclosing thing that owns a node's content: a component
 * definition, or the template child of a collection-bound repeater.
 */
function contentOwner(doc: DesignDoc, id: NodeId): { kind: 'collection' | 'component'; id: NodeId } | null {
  let child: AnyNode | null = null
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur) {
    if (cur.type === 'frame' && cur.isComponent) return { kind: 'component', id: cur.id }
    if (cur.type === 'frame' && cur.repeat?.mode === 'collection' && child && cur.children[0] === child.id) {
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
  nodeIds: NodeId[]
  sampleValue: string
}

interface TypeDraft {
  key: string
  name: string
  kind: SchemaType['kind']
  sourceId: NodeId
  itemCount?: number
  contributions: Contribution[]
}

function intentFor(field: FieldMeta | null | undefined, source: ContentSource): FieldIntent {
  if (field?.intent) return field.intent
  return source.type === 'generator' ? source.config.kind : 'custom'
}

function constraintFor(
  field: FieldMeta | null | undefined,
  source: ContentSource,
): { unit: GeneratorUnit; count: number } | null {
  if (field?.maxLength) return { ...field.maxLength }
  if (source.type === 'generator') return { unit: source.config.unit, count: source.config.count }
  return null
}

function nameFor(node: TextNode): string {
  if (node.field?.name.trim()) return node.field.name.trim()
  if (node.content.type === 'binding') {
    const leaf = pathLeaf(node.content.path)
    if (leaf) return leaf
  }
  if (node.content.type === 'prop') return node.content.prop
  return slugify(node.name) || 'field'
}

function contributionFromText(
  node: TextNode,
  doc: DesignDoc,
  ctx: RenderContext,
  type: SchemaField['type'],
): Contribution {
  const contribution: Contribution = {
    name: nameFor(node),
    intent: intentFor(node.field, node.content),
    type,
    source: node.content.type,
    nodeIds: [node.id],
    sampleValue: resolveContent(node.content, doc, ctx).text,
  }
  const description = node.field?.description?.trim()
  if (description) contribution.description = description
  const constraint = constraintFor(node.field, node.content)
  if (constraint) contribution.constraint = constraint
  if (node.content.type === 'binding') contribution.bindingPath = node.content.path
  return contribution
}

/** Text nodes inside a component definition, indexed by the prop they read. */
function propBoundTexts(doc: DesignDoc, componentId: NodeId): Map<string, TextNode[]> {
  const out = new Map<string, TextNode[]>()
  for (const id of subtree(doc, componentId)) {
    const node = doc.nodes[id]
    if (node?.type !== 'text' || node.content.type !== 'prop') continue
    const list = out.get(node.content.prop)
    if (list) list.push(node)
    else out.set(node.content.prop, [node])
  }
  return out
}

function collectionDraft(doc: DesignDoc, frame: FrameNode, path: string): TypeDraft {
  const collection = getByPath(doc.data, path)
  const items = Array.isArray(collection) ? collection : []
  const firstItem = items[0]
  const ctx: RenderContext = { item: firstItem, index: 0 }
  const leaf = pathLeaf(path) || slugify(frame.name) || 'items'
  const draft: TypeDraft = {
    key: slugify(leaf) || 'items',
    name: titleCase(leaf) || frame.name,
    kind: 'collection',
    sourceId: frame.id,
    itemCount: items.length,
    contributions: [],
  }

  const templateId = frame.children[0]
  if (!templateId) return draft

  const typeOf = (bindingPath: string | undefined, name: string): SchemaField['type'] => {
    const value = bindingPath ? getByPath(doc.data, bindingPath, ctx) : getByPath(firstItem, name)
    return inferType(value) ?? 'string'
  }

  for (const id of subtree(doc, templateId)) {
    const node = doc.nodes[id]
    if (!node) continue
    const owner = contentOwner(doc, id)
    if (owner?.kind !== 'collection' || owner.id !== frame.id) continue

    if (node.type === 'text') {
      const bound = node.content.type === 'binding' && isItemPath(node.content.path)
      if (!bound && !node.field) continue
      const partial = contributionFromText(node, doc, ctx, 'string')
      partial.type = typeOf(partial.bindingPath, partial.name)
      draft.contributions.push(partial)
      continue
    }

    if (node.type === 'instance') {
      // An instance in the template carries the collection's fields on its
      // `item.*` prop overrides; the definition's field markup names them.
      const def = doc.nodes[node.componentId]
      const metaByProp = new Map<string, FieldMeta>()
      const propOrder: string[] = []
      if (def?.type === 'frame') {
        for (const [prop, texts] of propBoundTexts(doc, def.id)) {
          const marked = texts.find((t) => t.field)
          if (marked?.field) metaByProp.set(prop, marked.field)
        }
        for (const p of def.props ?? []) propOrder.push(p.name)
      }
      for (const prop of Object.keys(node.overrides)) if (!propOrder.includes(prop)) propOrder.push(prop)

      for (const prop of propOrder) {
        const source = node.overrides[prop]
        if (source?.type !== 'binding' || !isItemPath(source.path)) continue
        const meta = metaByProp.get(prop)
        const name = meta?.name.trim() || pathLeaf(source.path) || prop
        const contribution: Contribution = {
          name,
          intent: meta?.intent ?? 'custom',
          type: typeOf(source.path, name),
          source: 'binding',
          bindingPath: source.path,
          nodeIds: [node.id],
          sampleValue: resolveContent(source, doc, ctx).text,
        }
        if (meta?.description?.trim()) contribution.description = meta.description.trim()
        if (meta?.maxLength) contribution.constraint = { ...meta.maxLength }
        draft.contributions.push(contribution)
      }
    }
  }
  return draft
}

function componentDraft(doc: DesignDoc, frame: FrameNode): TypeDraft {
  const draft: TypeDraft = {
    key: slugify(frame.name) || 'component',
    name: titleCase(frame.name) || frame.name,
    kind: 'component',
    sourceId: frame.id,
    contributions: [],
  }
  const byProp = propBoundTexts(doc, frame.id)
  const ctx: RenderContext = {
    propValues: Object.fromEntries((frame.props ?? []).map((p) => [p.name, p.defaultValue])),
  }

  for (const prop of frame.props ?? []) {
    const texts = (byProp.get(prop.name) ?? []).filter((t) => {
      const owner = contentOwner(doc, t.id)
      return owner?.kind === 'component' && owner.id === frame.id
    })
    const meta = texts.find((t) => t.field)?.field
    const contribution: Contribution = {
      name: meta?.name.trim() || prop.name,
      intent: meta?.intent ?? 'custom',
      type: 'string',
      source: 'prop',
      nodeIds: texts.map((t) => t.id),
      sampleValue: prop.defaultValue,
    }
    if (meta?.description?.trim()) contribution.description = meta.description.trim()
    if (meta?.maxLength) contribution.constraint = { ...meta.maxLength }
    draft.contributions.push(contribution)
  }

  // Annotated texts inside the definition that are not prop-bound keep their own source.
  for (const id of subtree(doc, frame.id)) {
    const node = doc.nodes[id]
    if (node?.type !== 'text' || node.content.type === 'prop' || !node.field) continue
    const owner = contentOwner(doc, id)
    if (owner?.kind !== 'component' || owner.id !== frame.id) continue
    const contribution = contributionFromText(node, doc, ctx, 'string')
    if (contribution.bindingPath) {
      contribution.type = inferType(getByPath(doc.data, contribution.bindingPath, ctx)) ?? 'string'
    }
    draft.contributions.push(contribution)
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
 * Derive the content schema from the document: collection-bound repeaters and
 * component definitions become types, everything else annotated or connected
 * groups into per-frame singletons.
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
    if (node.repeat?.mode === 'collection') collections.push(collectionDraft(doc, node, node.repeat.path))
    if (node.isComponent) components.push(componentDraft(doc, node))
  }

  let totalTextCount = 0
  let structuredTextCount = 0
  for (const id of order) {
    const node = doc.nodes[id]
    if (node?.type !== 'text') continue
    totalTextCount += 1
    const structured = !!node.field || node.content.type !== 'static'
    if (structured) structuredTextCount += 1
    if (!structured) continue
    if (contentOwner(doc, id)) continue

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
    const contribution = contributionFromText(node, doc, {}, 'string')
    if (contribution.bindingPath) {
      contribution.type = inferType(getByPath(doc.data, contribution.bindingPath)) ?? 'string'
    }
    draft.contributions.push(contribution)
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
    if (draft.kind === 'collection') type.itemCount = draft.itemCount ?? 0
    types.push(type)
  }

  applyPublishedIds(types, published)
  return { types, structuredTextCount, totalTextCount }
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
