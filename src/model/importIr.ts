import type { AnyNode, AutoLayout, FrameNode, NodeId, SizeMode, TextNode, TextStyle } from './types'
import { newId } from './types'

export interface ImportResult {
  /** Every created node, root first, with parentId/children already wired. */
  nodes: AnyNode[]
  rootId: NodeId
  /** Collections extracted from repeated structures, to merge into doc.data. */
  collections: Record<string, unknown[]>
  stats: { layerCount: number; repeaterCount: number; collectionNames: string[] }
}

// ---- intermediate representation ----
// Imported sources (HTML markup, Figma clipboard data) are converted to this
// tree first so repetition can be detected and rewritten before any node ids
// exist.

export interface IrCommon {
  /** Kind the node was derived from (an HTML tag or Figma node type); drives naming and signatures. */
  tag: string
  name: string
  /** Sanitized semantic name (class, id or layer name), used for field and collection names. */
  slug: string
  /** Full semantic identity, used to spot siblings that are the same kind of thing. */
  identity: string
  /** Position inside a parent without auto layout. */
  x?: number
  y?: number
}

export interface IrText extends IrCommon {
  kind: 'text'
  text: string
  style: TextStyle
  widthMode: SizeMode
  /** Used when widthMode is 'fixed'. */
  width?: number
  /** Button labels stay static: they are chrome, not item content. */
  bindable: boolean
  binding?: string
}

export interface IrFrame extends IrCommon {
  kind: 'frame'
  children: IrNode[]
  fill: string | null
  cornerRadius: number
  /** Null renders children at their absolute x/y instead of flowing them. */
  autoLayout: AutoLayout | null
  widthMode: SizeMode
  heightMode: SizeMode
  width: number
  height: number
  stroke?: string | null
  strokeWidth?: number
  clip?: boolean
  /** Inline-style values kept raw so an HTML root can fall back to its own defaults. */
  styleWidth: number | null
  stylePadX: number | null
  stylePadY: number | null
  styleGap: number | null
  repeatPath?: string
}

export type IrNode = IrText | IrFrame

export function sanitize(v: string | null | undefined): string {
  if (!v) return ''
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Fallback binding-field names when a slot has no semantic name of its own. */
const FIELD_NAMES: Record<string, string> = {
  h1: 'title',
  h2: 'title',
  h3: 'title',
  h4: 'title',
  h5: 'title',
  h6: 'title',
  p: 'body',
  a: 'link',
  small: 'meta',
  figcaption: 'meta',
  caption: 'meta',
  blockquote: 'body',
  li: 'body',
  text: 'text',
}

// ---- repetition detection ----

/** Shape only: tags and nesting, never text or style. */
export function signature(node: IrNode): string {
  if (node.kind === 'text') return `t:${node.tag}`
  return `f:${node.tag}(${node.children.map(signature).join(',')})`
}

export function collectSlots(node: IrNode, out: IrText[] = []): IrText[] {
  if (node.kind === 'text') {
    if (node.bindable) out.push(node)
    return out
  }
  for (const child of node.children) collectSlots(child, out)
  return out
}

function fieldNamesFor(slots: IrText[]): string[] {
  const used = new Map<string, number>()
  return slots.map((slot) => {
    const base = slot.slug || FIELD_NAMES[slot.tag] || 'label'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}${seen + 1}`
  })
}

function uniqueCollectionName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

export interface DetectResult {
  collections: Record<string, unknown[]>
  names: string[]
}

/**
 * Siblings repeat when they are shaped alike, or — for real-world content,
 * where cards drop an excerpt or an image — when they are the same tag with the
 * same semantic identity. The looser rule needs that identity: identical tags
 * alone are not evidence of a collection.
 */
export function isRepeatCandidate(kids: IrNode[]): boolean {
  if (kids.length < 3) return false
  const first = kids[0]
  const sig = signature(first)
  if (kids.every((k) => signature(k) === sig) && collectSlots(first).length > 0) return true
  if (!first.identity) return false
  return (
    kids.every((k) => k.tag === first.tag && k.identity === first.identity) &&
    kids.some((k) => collectSlots(k).length > 0)
  )
}

/** The richest sibling makes the best template: variants only ever drop content. */
function pickTemplate(kids: IrNode[]): IrNode {
  let best = kids[0]
  let bestCount = collectSlots(best).length
  for (const kid of kids.slice(1)) {
    const count = collectSlots(kid).length
    if (count > bestCount) {
      best = kid
      bestCount = count
    }
  }
  return best
}

export function detectRepeats(frame: IrFrame, used: Set<string>, out: DetectResult): void {
  const kids = frame.children
  // Repeater clones flow in the parent's layout, so a frame that positions its
  // children absolutely cannot collapse — the copies would stack in one spot.
  if (frame.autoLayout && isRepeatCandidate(kids)) {
    const template = pickTemplate(kids)
    const templateFields = fieldNamesFor(collectSlots(template))
    // Items are keyed by field name, not position, so variants still line up.
    const rows = kids.map((kid) => {
      const slots = collectSlots(kid)
      const fields = fieldNamesFor(slots)
      const row: Record<string, string> = {}
      fields.forEach((field, i) => {
        row[field] = slots[i]?.text ?? ''
      })
      return row
    })
    const keys: string[] = [...templateFields]
    for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key)
    const items = rows.map((row) => {
      const item: Record<string, string> = {}
      for (const key of keys) item[key] = row[key] ?? ''
      return item
    })
    const name = uniqueCollectionName(frame.slug || 'items', used)
    used.add(name)
    collectSlots(template).forEach((slot, i) => {
      slot.binding = `item.${templateFields[i]}`
    })
    frame.children = [template]
    frame.repeatPath = name
    out.collections[name] = items
    out.names.push(name)
    // A repeater's template is not searched again: no repeater-in-repeater.
    return
  }
  for (const kid of kids) if (kid.kind === 'frame') detectRepeats(kid, used, out)
}

// ---- IR → nodes ----

function emit(ir: IrNode, parentId: NodeId | null, out: AnyNode[]): NodeId {
  if (ir.kind === 'text') {
    const node: TextNode = {
      id: newId('text'),
      type: 'text',
      name: ir.name,
      parentId,
      x: ir.x ?? 0,
      y: ir.y ?? 0,
      width: ir.width ?? 240,
      height: 24,
      widthMode: ir.widthMode,
      heightMode: 'hug',
      style: ir.style,
      content: ir.binding ? { type: 'binding', path: ir.binding } : { type: 'static', value: ir.text },
    }
    out.push(node)
    return node.id
  }
  const node: FrameNode = {
    id: newId('frame'),
    type: 'frame',
    name: ir.name,
    parentId,
    x: ir.x ?? 0,
    y: ir.y ?? 0,
    width: ir.width,
    height: ir.height,
    widthMode: ir.widthMode,
    heightMode: ir.heightMode,
    children: [],
    fill: ir.fill,
    stroke: ir.stroke ?? null,
    strokeWidth: ir.strokeWidth ?? 1,
    cornerRadius: ir.cornerRadius,
    shadow: false,
    clip: ir.clip ?? false,
    autoLayout: ir.autoLayout,
  }
  if (ir.repeatPath) node.repeat = { mode: 'collection', path: ir.repeatPath }
  out.push(node)
  node.children = ir.children.map((child) => emit(child, node.id, out))
  return node.id
}

/** Detect repeated structures, then flatten the IR into concrete nodes. */
export function finishImport(root: IrFrame, existingDataKeys: string[]): ImportResult {
  const detected: DetectResult = { collections: {}, names: [] }
  detectRepeats(root, new Set(existingDataKeys), detected)

  const nodes: AnyNode[] = []
  const rootId = emit(root, null, nodes)

  return {
    nodes,
    rootId,
    collections: detected.collections,
    stats: {
      layerCount: nodes.length,
      repeaterCount: detected.names.length,
      collectionNames: detected.names,
    },
  }
}
