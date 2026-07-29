import { generateText } from './generators'
import type {
  DesignDoc,
  InstanceNode,
  NodeId,
  OverrideValue,
  RenderContext,
  TextField,
  TextNode,
} from './types'

/**
 * Resolve a dot/bracket path like "articles[2].title" against a value.
 * Paths starting with "item" resolve against the current repeater item.
 */
export function getByPath(root: unknown, path: string, ctx?: RenderContext): unknown {
  let target = root
  let rest = path.trim()
  if (rest === 'item' || rest.startsWith('item.') || rest.startsWith('item[')) {
    target = ctx?.item
    rest = rest === 'item' ? '' : rest.slice(4).replace(/^\./, '')
  }
  if (rest === '') return target
  const segments = rest
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur: unknown = target
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function stringify(v: unknown): string {
  if (v === undefined) return ''
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function resolveBinding(path: string, doc: DesignDoc, ctx: RenderContext): { text: string; missing: boolean } {
  const v = getByPath(doc.data, path, ctx)
  if (v === undefined) return { text: path, missing: true }
  return { text: stringify(v), missing: false }
}

/**
 * The string a text layer shows. Plain text and unconnected fields show their
 * own literal text; connected fields resolve their connection — unless an
 * enclosing instance overrode the field, which wins over anything the
 * definition says.
 */
export function resolveText(
  node: TextNode,
  doc: DesignDoc,
  ctx: RenderContext = {},
): { text: string; missing: boolean } {
  const field = node.field
  if (field) {
    const override = ctx.fieldValues?.[field.name]
    if (override !== undefined) return { text: override, missing: false }
  }
  if (!field || field.connection.type === 'none') return { text: node.text, missing: false }
  if (field.connection.type === 'generator') {
    return { text: generateText(field.connection.config, ctx.seedOffset ?? 0), missing: false }
  }
  return resolveBinding(field.connection.path, doc, ctx)
}

/** Resolve one per-instance override value. */
export function resolveOverride(
  value: OverrideValue,
  doc: DesignDoc,
  ctx: RenderContext = {},
): { text: string; missing: boolean } {
  switch (value.type) {
    case 'static':
      return { text: value.value, missing: false }
    case 'generator':
      return { text: generateText(value.config, ctx.seedOffset ?? 0), missing: false }
    case 'binding':
      return resolveBinding(value.path, doc, ctx)
  }
}

/**
 * A component's content API: the designated fields inside its definition, in
 * tree order, deduped by field name (first one wins).
 */
export function componentFields(
  doc: DesignDoc,
  componentId: NodeId,
): { node: TextNode; field: TextField }[] {
  const out: { node: TextNode; field: TextField }[] = []
  const seen = new Set<string>()
  const visit = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    if (node.type === 'text' && node.field) {
      const name = node.field.name
      if (!seen.has(name)) {
        seen.add(name)
        out.push({ node, field: node.field })
      }
    }
    if (node.type === 'frame') node.children.forEach(visit)
  }
  visit(componentId)
  return out
}

/**
 * The RenderContext.fieldValues for an instance: only the fields it actually
 * overrides. Un-overridden fields are left out on purpose, so the definition's
 * own connection resolves naturally in the instance's context.
 */
export function instanceFieldValues(
  doc: DesignDoc,
  instance: InstanceNode,
  ctx: RenderContext = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { field } of componentFields(doc, instance.componentId)) {
    const override = instance.overrides[field.name]
    if (override) out[field.name] = resolveOverride(override, doc, ctx).text
  }
  return out
}

export interface DataPath {
  path: string
  /** A short preview of the value at this path. */
  preview: string
  kind: 'string' | 'number' | 'boolean'
}

export interface CollectionPath {
  path: string
  length: number
}

const MAX_PATHS = 400

/** Enumerate bindable leaf paths (strings/numbers/booleans) in a data value. */
export function listLeafPaths(data: unknown, prefix = ''): DataPath[] {
  const out: DataPath[] = []
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= MAX_PATHS || depth > 6) return
    if (v == null) return
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      if (path) {
        const s = String(v)
        out.push({
          path,
          preview: s.length > 42 ? s.slice(0, 42) + '…' : s,
          kind: typeof v as DataPath['kind'],
        })
      }
      return
    }
    if (Array.isArray(v)) {
      v.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1))
      return
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, path ? `${path}.${k}` : k, depth + 1)
      }
    }
  }
  walk(data, prefix, 0)
  return out
}

/** Enumerate array-of-object paths usable as repeater collections. */
export function listCollectionPaths(data: unknown): CollectionPath[] {
  const out: CollectionPath[] = []
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 5 || v == null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      if (path) out.push({ path, length: v.length })
      // Only descend into the first element to discover nested collections.
      if (v.length > 0) walk(v[0], `${path}[0]`, depth + 1)
      return
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      walk(child, path ? `${path}.${k}` : k, depth + 1)
    }
  }
  walk(data, '', 0)
  return out
}

/**
 * Paths available to a field binding in a given spot: all leaf paths of the
 * document data, plus `item.*` paths when inside a collection-bound repeater
 * (derived from the collection's first item).
 */
export function bindablePaths(doc: DesignDoc, collectionPath?: string): DataPath[] {
  const paths: DataPath[] = []
  if (collectionPath) {
    const coll = getByPath(doc.data, collectionPath)
    if (Array.isArray(coll) && coll.length > 0) {
      paths.push(...listLeafPaths(coll[0], 'item'))
    }
  }
  paths.push(...listLeafPaths(doc.data))
  return paths
}
