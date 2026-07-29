import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { importHtml } from './model/htmlImport'
import { buildSeedDoc } from './model/seed'
import { getByPath, instanceFieldValues, resolveText } from './model/resolve'
import { deriveSchema, fieldOwner, pathLeaf, publishSchema, type PublishedSchema } from './model/schema'
import {
  DEFAULT_AUTO_LAYOUT,
  DEFAULT_TEXT_STYLE,
  newId,
  type AnyNode,
  type AutoLayout,
  type DesignDoc,
  type FieldConnection,
  type FrameNode,
  type InstanceNode,
  type NodeId,
  type OverrideValue,
  type RenderContext,
  type RepeatConfig,
  type SizeMode,
  type TextField,
  type TextNode,
  type TextStyle,
} from './model/types'

export type Tool = 'select' | 'frame' | 'text'
export type LeftTab = 'layers' | 'data' | 'assets'
/** Design mode edits the document; dev mode inspects it. */
export type Mode = 'design' | 'dev'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** The parts of a field an author edits directly; the connection has its own action. */
export type FieldPatch = Partial<Pick<TextField, 'name' | 'intent' | 'description' | 'maxLength'>>

const STORAGE_KEY = 'frameshift-doc-v4'
const SCHEMA_KEY = 'frameshift-schema-v3'
const HISTORY_LIMIT = 60

interface EditorState {
  doc: DesignDoc
  selection: NodeId[]
  hoveredId: NodeId | null
  editingId: NodeId | null
  tool: Tool
  mode: Mode
  leftTab: LeftTab
  viewport: Viewport
  past: DesignDoc[]
  future: DesignDoc[]
  toast: string | null
  /** Last published schema — versioned separately from the document. */
  publishedSchema: PublishedSchema | null

  // -- ui --
  setTool: (t: Tool) => void
  setMode: (m: Mode) => void
  setToast: (msg: string | null) => void
  setLeftTab: (t: LeftTab) => void
  setViewport: (v: Viewport) => void
  select: (ids: NodeId[], additive?: boolean) => void
  setHovered: (id: NodeId | null) => void
  setEditing: (id: NodeId | null) => void

  // -- history --
  pushHistory: () => void
  undo: () => void
  redo: () => void

  // -- node edits --
  patchNode: (id: NodeId, patch: Partial<AnyNode>) => void
  /** Same as patchNode but does not push undo history (for drags; push once at drag start). */
  patchNodeTransient: (id: NodeId, patch: Partial<AnyNode>) => void
  patchNodes: (ids: NodeId[], patch: Partial<AnyNode>) => void
  patchTextStyle: (id: NodeId, patch: Partial<TextStyle>) => void
  setSizeMode: (id: NodeId, axis: 'width' | 'height', mode: SizeMode) => void
  renameNode: (id: NodeId, name: string) => void
  setAutoLayout: (id: NodeId, al: AutoLayout | null, baked?: Record<NodeId, { x: number; y: number; width: number; height: number }>) => void
  patchAutoLayout: (id: NodeId, patch: Partial<AutoLayout>) => void
  addFrameAt: (parentId: NodeId | null, x: number, y: number, w: number, h: number, name?: string) => NodeId
  addTextAt: (parentId: NodeId | null, x: number, y: number, width?: number) => NodeId
  deleteNodes: (ids: NodeId[]) => void
  duplicateNodes: (ids: NodeId[]) => void
  moveNodesBy: (ids: NodeId[], dx: number, dy: number) => void
  moveChild: (parentId: NodeId, from: number, to: number) => void

  // -- text & fields --
  /** Write a text layer's literal text (plain text, or a field's placeholder). */
  setText: (id: NodeId, value: string) => void
  commitTextEdit: (id: NodeId, value: string) => void
  /** Designate plain text as a content field, with a default name. */
  markAsField: (id: NodeId) => void
  /** Edit field metadata. Renaming inside a bound template may snap a binding. */
  updateField: (id: NodeId, patch: FieldPatch) => void
  /** Connect / disconnect a field; connecting plain text auto-promotes it. */
  setFieldConnection: (id: NodeId, connection: FieldConnection) => void
  /** Demote a field back to plain text, baking in what it showed. */
  removeField: (id: NodeId) => void

  // -- schema --
  publishCurrentSchema: () => void

  // -- components --
  makeComponent: (frameId: NodeId) => void
  insertInstance: (componentId: NodeId, x: number, y: number) => NodeId
  setInstanceOverride: (instanceId: NodeId, fieldName: string, value: OverrideValue | null) => void
  detachInstance: (instanceId: NodeId) => void

  // -- repeater --
  setRepeat: (frameId: NodeId, cfg: RepeatConfig | null) => void
  /** Promote an existing wrapper frame to a repeater (count mode, 3 clones). */
  makeRepeater: (frameId: NodeId) => void
  /** Wrap a node in a new repeater frame that takes its place. */
  repeatNode: (nodeId: NodeId) => NodeId | null
  addEmptyState: (repeaterId: NodeId) => void

  // -- data --
  setData: (data: unknown) => void
  resetDoc: () => void

  // -- import --
  importHtmlMarkup: (html: string) => { ok: boolean; message: string }
}

function loadInitialDoc(): DesignDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DesignDoc
      if (parsed && parsed.nodes && parsed.rootIds) return parsed
    }
  } catch {
    // fall through to seed
  }
  return buildSeedDoc()
}

function loadPublishedSchema(): PublishedSchema | null {
  try {
    const raw = localStorage.getItem(SCHEMA_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PublishedSchema
      if (parsed && Array.isArray(parsed.types)) return parsed
    }
  } catch {
    // fall through to unpublished
  }
  return null
}

/** Deep-clone via JSON: docs are JSON-serializable, and this reads through immer drafts. */
function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

function snapshot(doc: DesignDoc): DesignDoc {
  return deepClone(doc)
}

/** Collect a subtree's ids (depth-first, root included). */
export function collectSubtree(doc: DesignDoc, id: NodeId, out: NodeId[] = []): NodeId[] {
  const node = doc.nodes[id]
  if (!node) return out
  out.push(id)
  if (node.type === 'frame') for (const c of node.children) collectSubtree(doc, c, out)
  return out
}

function removeFromParent(doc: DesignDoc, id: NodeId) {
  const node = doc.nodes[id]
  if (!node) return
  if (node.parentId) {
    const p = doc.nodes[node.parentId]
    if (p && p.type === 'frame') p.children = p.children.filter((c) => c !== id)
  } else {
    doc.rootIds = doc.rootIds.filter((r) => r !== id)
  }
}

function cloneSubtree(
  doc: DesignDoc,
  id: NodeId,
  parentId: NodeId | null,
): { rootId: NodeId; nodes: AnyNode[] } {
  const src = doc.nodes[id]
  const copy = deepClone(src) as AnyNode
  copy.id = newId(src.type === 'frame' ? 'frame' : src.type)
  copy.parentId = parentId
  const nodes: AnyNode[] = [copy]
  if (copy.type === 'frame') {
    const newChildren: NodeId[] = []
    for (const childId of (src as FrameNode).children) {
      const sub = cloneSubtree(doc, childId, copy.id)
      newChildren.push(sub.rootId)
      nodes.push(...sub.nodes)
    }
    copy.children = newChildren
  }
  return { rootId: copy.id, nodes }
}

// ---- field scope helpers ----

function rootIdOf(doc: DesignDoc, id: NodeId): NodeId | undefined {
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur?.parentId) {
    const parent: AnyNode | undefined = doc.nodes[cur.parentId]
    if (!parent) break
    cur = parent
  }
  return cur?.id
}

/**
 * The nodes a field name has to be unique within: its component definition,
 * its repeater template, or — for loose fields — its root frame.
 */
function fieldScope(doc: DesignDoc, id: NodeId): NodeId[] {
  const owner = fieldOwner(doc, id)
  if (owner?.kind === 'component') return collectSubtree(doc, owner.id)
  if (owner?.kind === 'collection') {
    const frame = doc.nodes[owner.id]
    const templateId = frame?.type === 'frame' ? frame.children[0] : undefined
    return templateId ? collectSubtree(doc, templateId) : []
  }
  const rootId = rootIdOf(doc, id)
  return rootId ? collectSubtree(doc, rootId) : []
}

function scopeFieldNames(doc: DesignDoc, id: NodeId): Set<string> {
  const names = new Set<string>()
  for (const nid of fieldScope(doc, id)) {
    const node = doc.nodes[nid]
    if (nid !== id && node?.type === 'text' && node.field) names.add(node.field.name)
  }
  return names
}

/** The lowest free text_field_N in scope — the "Frame 12" of content fields. */
function nextDefaultName(doc: DesignDoc, id: NodeId): string {
  const used = scopeFieldNames(doc, id)
  let n = 1
  while (used.has(`text_field_${n}`)) n += 1
  return `text_field_${n}`
}

/** Auto-promotion names from the connection, deduped with -2, -3 … suffixes. */
function uniqueFieldName(doc: DesignDoc, id: NodeId, base: string): string {
  const used = scopeFieldNames(doc, id)
  const stem = base || 'field'
  if (!used.has(stem)) return stem
  let n = 2
  while (used.has(`${stem}-${n}`)) n += 1
  return `${stem}-${n}`
}

/** The collection a node's template sits in, if any. */
function templateCollectionPath(doc: DesignDoc, id: NodeId): string | undefined {
  const owner = fieldOwner(doc, id)
  if (owner?.kind !== 'collection') return undefined
  const frame = doc.nodes[owner.id]
  if (frame?.type !== 'frame' || frame.repeat?.mode !== 'collection') return undefined
  return frame.repeat.path
}

/**
 * A best-effort render context for a node outside of React: supplies the first
 * item of the enclosing collection so baked text matches what was on canvas.
 */
function contextFor(doc: DesignDoc, id: NodeId): RenderContext {
  const path = templateCollectionPath(doc, id)
  if (!path) return {}
  const items = getByPath(doc.data, path)
  return Array.isArray(items) ? { item: items[0], index: 0 } : {}
}

/** What a text layer currently shows — the value Disconnect and Remove field bake in. */
function shownText(doc: DesignDoc, node: TextNode): string {
  return resolveText(node, doc, contextFor(doc, node.id)).text
}

export const useStore = create<EditorState>()(
  immer((set, get) => {
    // Consecutive mutations that share a coalesce key (per-keystroke typing)
    // collapse into one undo entry; any other mutation ends the burst.
    let coalesceKey: string | null = null

    const withHistory = (fn: (state: { doc: DesignDoc } & EditorState) => void, coalesce?: string) => {
      // Snapshot the committed (non-draft) doc — immer drafts can't be structuredCloned.
      const { past, doc } = get()
      let newPast = past
      if (!(coalesce && coalesce === coalesceKey)) {
        newPast = [...past, snapshot(doc)]
        if (newPast.length > HISTORY_LIMIT) newPast.shift()
      }
      coalesceKey = coalesce ?? null
      set((s) => {
        s.past = newPast
        s.future = []
        fn(s as unknown as { doc: DesignDoc } & EditorState)
      })
    }
    const endCoalesce = () => {
      coalesceKey = null
    }

    return {
      doc: loadInitialDoc(),
      selection: [],
      hoveredId: null,
      editingId: null,
      tool: 'select',
      mode: 'design',
      leftTab: 'layers',
      viewport: { x: 40, y: 20, zoom: 0.75 },
      past: [],
      future: [],
      toast: null,
      publishedSchema: loadPublishedSchema(),

      setTool: (t) => set({ tool: t }),
      setMode: (m) =>
        set((s) => {
          s.mode = m
          // Dev mode is inspect-only: drop any in-progress edit or drawing tool.
          if (m === 'dev') {
            s.editingId = null
            s.tool = 'select'
          }
        }),
      setToast: (msg) => {
        set({ toast: msg })
        if (msg) {
          setTimeout(() => {
            if (useStore.getState().toast === msg) useStore.setState({ toast: null })
          }, 3200)
        }
      },
      setLeftTab: (t) => set({ leftTab: t }),
      setViewport: (v) => set({ viewport: v }),
      select: (ids, additive) =>
        set((s) => {
          if (additive) {
            const next = new Set(s.selection)
            for (const id of ids) (next.has(id) ? next.delete(id) : next.add(id))
            s.selection = [...next]
          } else {
            s.selection = ids
          }
          if (s.editingId && !s.selection.includes(s.editingId)) s.editingId = null
        }),
      setHovered: (id) => set({ hoveredId: id }),
      setEditing: (id) => set({ editingId: id }),

      pushHistory: () => {
        endCoalesce()
        const { past, doc } = get()
        const newPast = [...past, snapshot(doc)]
        if (newPast.length > HISTORY_LIMIT) newPast.shift()
        set({ past: newPast, future: [] })
      },
      undo: () => {
        endCoalesce()
        const { past, future, doc, selection } = get()
        const prev = past[past.length - 1]
        if (!prev) return
        set({
          past: past.slice(0, -1),
          future: [...future, snapshot(doc)],
          doc: prev,
          selection: selection.filter((id) => prev.nodes[id]),
          editingId: null,
        })
      },
      redo: () => {
        endCoalesce()
        const { past, future, doc, selection } = get()
        const next = future[future.length - 1]
        if (!next) return
        set({
          future: future.slice(0, -1),
          past: [...past, snapshot(doc)],
          doc: next,
          selection: selection.filter((id) => next.nodes[id]),
          editingId: null,
        })
      },

      patchNode: (id, patch) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node) Object.assign(node, patch)
        }),
      patchNodeTransient: (id, patch) =>
        set((s) => {
          const node = s.doc.nodes[id]
          if (node) Object.assign(node, patch)
        }),
      patchNodes: (ids, patch) =>
        withHistory((s) => {
          for (const id of ids) {
            const node = s.doc.nodes[id]
            if (node) Object.assign(node, patch)
          }
        }),
      patchTextStyle: (id, patch) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type === 'text') Object.assign(node.style, patch)
        }),
      setSizeMode: (id, axis, mode) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (!node) return
          if (axis === 'width') node.widthMode = mode
          else node.heightMode = mode
        }),
      renameNode: (id, name) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node) node.name = name
        }),

      setAutoLayout: (id, al, baked) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'frame') return
          if (al && !node.autoLayout) {
            // Entering auto layout: order children top-to-bottom / left-to-right.
            const children = node.children
              .map((c) => s.doc.nodes[c])
              .filter(Boolean)
            children.sort((a, b) => (al.direction === 'column' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y))
            node.children = children.map((c) => c.id)
          }
          if (!al && baked) {
            for (const [childId, rect] of Object.entries(baked)) {
              const child = s.doc.nodes[childId]
              if (!child) continue
              child.x = rect.x
              child.y = rect.y
              child.width = rect.width
              child.height = rect.height
              if (child.widthMode === 'fill') child.widthMode = 'fixed'
              if (child.heightMode === 'fill') child.heightMode = 'fixed'
            }
          }
          node.autoLayout = al
        }),
      patchAutoLayout: (id, patch) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type === 'frame' && node.autoLayout) Object.assign(node.autoLayout, patch)
        }),

      addFrameAt: (parentId, x, y, w, h, name = 'Frame') => {
        const id = newId('frame')
        withHistory((s) => {
          const node: FrameNode = {
            id,
            type: 'frame',
            name,
            parentId,
            x,
            y,
            width: Math.max(8, w),
            height: Math.max(8, h),
            widthMode: 'fixed',
            heightMode: 'fixed',
            children: [],
            fill: '#ffffff',
            stroke: null,
            strokeWidth: 1,
            cornerRadius: 0,
            shadow: false,
            clip: false,
            autoLayout: null,
          }
          s.doc.nodes[id] = node
          if (parentId && s.doc.nodes[parentId]?.type === 'frame') {
            ;(s.doc.nodes[parentId] as FrameNode).children.push(id)
          } else {
            node.parentId = null
            s.doc.rootIds.push(id)
          }
          s.selection = [id]
          s.tool = 'select'
        })
        return id
      },

      addTextAt: (parentId, x, y, width) => {
        const id = newId('text')
        withHistory((s) => {
          // New text is plain text: designation is always a deliberate act.
          const node: TextNode = {
            id,
            type: 'text',
            name: 'Text',
            parentId,
            x,
            y,
            width: width ?? 160,
            height: 24,
            widthMode: width ? 'fixed' : 'hug',
            heightMode: 'hug',
            style: { ...DEFAULT_TEXT_STYLE },
            text: 'Text',
          }
          s.doc.nodes[id] = node
          if (parentId && s.doc.nodes[parentId]?.type === 'frame') {
            ;(s.doc.nodes[parentId] as FrameNode).children.push(id)
          } else {
            node.parentId = null
            s.doc.rootIds.push(id)
          }
          s.selection = [id]
          s.tool = 'select'
          s.editingId = id
        })
        return id
      },

      deleteNodes: (ids) =>
        withHistory((s) => {
          const toDelete = new Set<NodeId>()
          for (const id of ids) collectSubtree(s.doc, id, []).forEach((n) => toDelete.add(n))
          // Also delete instances of any component being deleted.
          const deletedComponents = [...toDelete].filter(
            (id) => (s.doc.nodes[id] as FrameNode | undefined)?.type === 'frame' && (s.doc.nodes[id] as FrameNode).isComponent,
          )
          if (deletedComponents.length) {
            for (const node of Object.values(s.doc.nodes)) {
              if (node.type === 'instance' && deletedComponents.includes(node.componentId)) {
                collectSubtree(s.doc, node.id, []).forEach((n) => toDelete.add(n))
              }
            }
          }
          for (const id of toDelete) removeFromParent(s.doc, id)
          for (const id of toDelete) delete s.doc.nodes[id]
          s.selection = s.selection.filter((id) => !toDelete.has(id))
          if (s.editingId && toDelete.has(s.editingId)) s.editingId = null
        }),

      duplicateNodes: (ids) =>
        withHistory((s) => {
          const newIds: NodeId[] = []
          for (const id of ids) {
            const src = s.doc.nodes[id]
            if (!src) continue
            const { rootId, nodes } = cloneSubtree(s.doc, id, src.parentId)
            for (const n of nodes) s.doc.nodes[n.id] = n
            const root = s.doc.nodes[rootId]
            root.name = src.name + ' copy'
            root.x = src.x + 24
            root.y = src.y + 24
            if (src.parentId && s.doc.nodes[src.parentId]?.type === 'frame') {
              const p = s.doc.nodes[src.parentId] as FrameNode
              p.children.splice(p.children.indexOf(id) + 1, 0, rootId)
            } else {
              s.doc.rootIds.splice(s.doc.rootIds.indexOf(id) + 1, 0, rootId)
            }
            newIds.push(rootId)
          }
          s.selection = newIds
        }),

      moveNodesBy: (ids, dx, dy) =>
        set((s) => {
          for (const id of ids) {
            const node = s.doc.nodes[id]
            if (!node) continue
            node.x += dx
            node.y += dy
          }
        }),

      moveChild: (parentId, from, to) =>
        set((s) => {
          const p = s.doc.nodes[parentId]
          if (p?.type !== 'frame') return
          if (from < 0 || from >= p.children.length) return
          const clamped = Math.max(0, Math.min(p.children.length - 1, to))
          const [moved] = p.children.splice(from, 1)
          p.children.splice(clamped, 0, moved)
        }),

      setText: (id, value) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'text') return
          // Connected fields own their value; their text is only a placeholder.
          if (node.field && node.field.connection.type !== 'none') return
          node.text = value
        }, `text:${id}`),

      commitTextEdit: (id, value) => {
        const { doc, editingId } = get()
        const node = doc.nodes[id]
        const writable = node?.type === 'text' && (!node.field || node.field.connection.type === 'none')
        // An edit that changed nothing must not cost an undo entry.
        if (!writable || node.text === value) {
          if (editingId === id) set({ editingId: null })
          return
        }
        withHistory((s) => {
          const n = s.doc.nodes[id]
          if (n?.type === 'text') n.text = value
          if (s.editingId === id) s.editingId = null
        })
      },

      markAsField: (id) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'text' || node.field) return
          node.field = {
            name: nextDefaultName(s.doc, id),
            intent: 'custom',
            connection: { type: 'none' },
          }
        }),

      updateField: (id, patch) => {
        // Written from inside the immer callback, read after it commits.
        const snap = { name: '' }
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'text' || !node.field) return
          const field = node.field
          const previousName = field.name
          if (patch.name !== undefined) field.name = patch.name.trim() || previousName
          if (patch.intent !== undefined) field.intent = patch.intent
          if (patch.description !== undefined) field.description = patch.description
          if (patch.maxLength !== undefined) field.maxLength = patch.maxLength

          // Name-as-mapping: renaming an unconnected field to match the data
          // inside a bound template IS the act of connecting it.
          if (field.name === previousName || field.connection.type !== 'none') return
          const path = templateCollectionPath(s.doc, id)
          if (!path) return
          const items = getByPath(s.doc.data, path)
          const first = Array.isArray(items) ? items[0] : undefined
          if (first === undefined || getByPath(first, field.name) === undefined) return
          field.connection = { type: 'binding', path: `item.${field.name}` }
          snap.name = field.name
        })
        if (snap.name) {
          get().setToast(
            `Connected to item.${snap.name} — disconnect in the Content panel to keep the placeholder.`,
          )
        }
      },

      setFieldConnection: (id, connection) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'text') return
          if (!node.field) {
            // Connecting is marking: promote in the same action, name prefilled.
            if (connection.type === 'none') return
            const base =
              connection.type === 'binding' ? pathLeaf(connection.path) : connection.config.kind
            node.field = {
              name: uniqueFieldName(s.doc, id, base),
              intent: connection.type === 'generator' ? connection.config.kind : 'custom',
              maxLength:
                connection.type === 'generator'
                  ? { unit: connection.config.unit, count: connection.config.count }
                  : null,
              connection,
            }
            return
          }
          // Disconnect keeps the field; the last shown text becomes the placeholder.
          if (connection.type === 'none' && node.field.connection.type !== 'none') {
            node.text = shownText(s.doc, node)
          }
          node.field.connection = connection
        }),

      removeField: (id) =>
        withHistory((s) => {
          const node = s.doc.nodes[id]
          if (node?.type !== 'text' || !node.field) return
          node.text = shownText(s.doc, node)
          delete node.field
        }),

      publishCurrentSchema: () => {
        const { doc, publishedSchema } = get()
        const next = publishSchema(publishedSchema, deriveSchema(doc, publishedSchema))
        set({ publishedSchema: next })
        try {
          localStorage.setItem(SCHEMA_KEY, JSON.stringify(next))
        } catch {
          // storage full / unavailable — persistence is best-effort
        }
      },

      makeComponent: (frameId) =>
        withHistory((s) => {
          const node = s.doc.nodes[frameId]
          if (node?.type !== 'frame' || node.isComponent || node.repeat) return
          node.isComponent = true
          if (node.name === 'Frame') node.name = 'Component'
        }),

      insertInstance: (componentId, x, y) => {
        const id = newId('instance')
        withHistory((s) => {
          const comp = s.doc.nodes[componentId]
          if (comp?.type !== 'frame' || !comp.isComponent) return
          const node: InstanceNode = {
            id,
            type: 'instance',
            name: comp.name,
            parentId: null,
            x,
            y,
            width: comp.width,
            height: comp.height,
            widthMode: comp.widthMode,
            heightMode: comp.heightMode,
            componentId,
            overrides: {},
          }
          s.doc.nodes[id] = node
          s.doc.rootIds.push(id)
          s.selection = [id]
        })
        return id
      },

      setInstanceOverride: (instanceId, fieldName, value) =>
        withHistory(
          (s) => {
            const node = s.doc.nodes[instanceId]
            if (node?.type !== 'instance') return
            if (value === null) delete node.overrides[fieldName]
            else node.overrides[fieldName] = value
          },
          // Static values arrive per keystroke from the sidebar; one undo entry.
          value?.type === 'static' ? `override:${instanceId}:${fieldName}` : undefined,
        ),

      detachInstance: (instanceId) =>
        withHistory((s) => {
          const inst = s.doc.nodes[instanceId]
          if (inst?.type !== 'instance') return
          const comp = s.doc.nodes[inst.componentId]
          if (comp?.type !== 'frame') return
          // Resolve the instance's overrides before cloning: the copy keeps the
          // text it showed, as plain text — the component API stays behind.
          const ctx = contextFor(s.doc, instanceId)
          const values = instanceFieldValues(s.doc, inst, ctx)

          const { rootId, nodes } = cloneSubtree(s.doc, comp.id, inst.parentId)
          for (const n of nodes) s.doc.nodes[n.id] = n
          const root = s.doc.nodes[rootId] as FrameNode
          root.isComponent = false
          root.name = inst.name
          root.x = inst.x
          root.y = inst.y
          root.width = inst.width
          root.height = inst.height
          root.widthMode = inst.widthMode
          root.heightMode = inst.heightMode
          for (const id of collectSubtree(s.doc, rootId, [])) {
            const n = s.doc.nodes[id]
            if (n?.type !== 'text' || !n.field) continue
            n.text = values[n.field.name] ?? resolveText(n, s.doc, ctx).text
            delete n.field
          }
          // Swap into the tree where the instance was.
          if (inst.parentId && s.doc.nodes[inst.parentId]?.type === 'frame') {
            const p = s.doc.nodes[inst.parentId] as FrameNode
            p.children.splice(p.children.indexOf(instanceId), 1, rootId)
          } else {
            s.doc.rootIds.splice(s.doc.rootIds.indexOf(instanceId), 1, rootId)
          }
          delete s.doc.nodes[instanceId]
          s.selection = [rootId]
        }),

      setRepeat: (frameId, cfg) =>
        withHistory((s) => {
          const node = s.doc.nodes[frameId]
          if (node?.type !== 'frame' || node.isComponent) return
          node.repeat = cfg
        }),

      makeRepeater: (frameId) =>
        withHistory((s) => {
          const node = s.doc.nodes[frameId]
          if (node?.type !== 'frame' || node.isComponent || node.repeat) return
          if (!node.children.length) return
          // Count mode with 3 clones: the effect is visible before any question.
          node.repeat = { mode: 'count', count: 3 }
        }),

      repeatNode: (nodeId) => {
        const wrapperId = newId('frame')
        const result = { created: false }
        withHistory((s) => {
          const node = s.doc.nodes[nodeId]
          if (!node) return
          if (node.type === 'frame' && node.isComponent) return
          const parent = node.parentId ? s.doc.nodes[node.parentId] : undefined
          const parentFrame = parent?.type === 'frame' ? parent : undefined
          const wrapper: FrameNode = {
            id: wrapperId,
            type: 'frame',
            name: `${node.name} repeater`,
            parentId: parentFrame ? parentFrame.id : null,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            widthMode: node.widthMode,
            heightMode: node.heightMode,
            children: [nodeId],
            fill: null,
            stroke: null,
            strokeWidth: 1,
            cornerRadius: 0,
            shadow: false,
            clip: false,
            // Inherit the flow the node already sat in, so clones stack the same way.
            autoLayout: {
              ...DEFAULT_AUTO_LAYOUT,
              direction: parentFrame?.autoLayout?.direction ?? 'column',
              gap: 12,
              paddingX: 0,
              paddingY: 0,
            },
            repeat: { mode: 'count', count: 3 },
          }
          s.doc.nodes[wrapperId] = wrapper
          // The wrapper takes the node's place, the node becomes its template.
          if (parentFrame) {
            const i = parentFrame.children.indexOf(nodeId)
            if (i >= 0) parentFrame.children.splice(i, 1, wrapperId)
            else parentFrame.children.push(wrapperId)
          } else {
            const i = s.doc.rootIds.indexOf(nodeId)
            if (i >= 0) s.doc.rootIds.splice(i, 1, wrapperId)
            else s.doc.rootIds.push(wrapperId)
          }
          node.parentId = wrapperId
          node.x = 0
          node.y = 0
          s.selection = [wrapperId]
          result.created = true
        })
        return result.created ? wrapperId : null
      },

      addEmptyState: (repeaterId) =>
        withHistory((s) => {
          const frame = s.doc.nodes[repeaterId]
          if (frame?.type !== 'frame' || !frame.repeat || frame.children.length !== 1) return
          const emptyId = newId('frame')
          const textId = newId('text')
          const empty: FrameNode = {
            id: emptyId,
            type: 'frame',
            name: 'Empty state',
            parentId: repeaterId,
            x: 0,
            y: 0,
            width: frame.width,
            height: 96,
            widthMode: 'fill',
            heightMode: 'hug',
            children: [textId],
            fill: null,
            stroke: '#d8d2c6',
            strokeWidth: 1,
            cornerRadius: 8,
            shadow: false,
            clip: false,
            autoLayout: {
              direction: 'column',
              gap: 8,
              paddingX: 24,
              paddingY: 24,
              align: 'center',
              justify: 'center',
              wrap: false,
            },
          }
          const label: TextNode = {
            id: textId,
            type: 'text',
            name: 'Empty text',
            parentId: emptyId,
            x: 0,
            y: 0,
            width: 200,
            height: 24,
            widthMode: 'hug',
            heightMode: 'hug',
            style: { ...DEFAULT_TEXT_STYLE, fontSize: 14, color: '#8a8a8a', textAlign: 'center' },
            text: 'No items yet',
          }
          s.doc.nodes[emptyId] = empty
          s.doc.nodes[textId] = label
          frame.children.push(emptyId)
        }),

      setData: (data) =>
        withHistory((s) => {
          s.doc.data = data
        }),

      resetDoc: () => {
        endCoalesce()
        const { past, doc } = get()
        set({
          past: [...past, snapshot(doc)],
          future: [],
          doc: buildSeedDoc(),
          selection: [],
          editingId: null,
          publishedSchema: null,
        })
        try {
          localStorage.removeItem(SCHEMA_KEY)
        } catch {
          // storage unavailable — nothing to clear
        }
      },

      importHtmlMarkup: (html) => {
        const state = get()
        const data = state.doc.data
        const existingKeys =
          data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : []
        const result = importHtml(html, existingKeys)
        if (!result) {
          const message = 'No convertible HTML found.'
          state.setToast(message)
          return { ok: false, message }
        }

        // Drop the import to the right of everything already on the canvas.
        const roots = state.doc.rootIds.map((id) => state.doc.nodes[id]).filter(Boolean)
        const x = roots.length ? Math.max(...roots.map((n) => n.x + n.width)) + 80 : 100
        const y = roots.length ? Math.min(...roots.map((n) => n.y)) : 100

        withHistory((s) => {
          for (const node of result.nodes) s.doc.nodes[node.id] = node
          const root = s.doc.nodes[result.rootId]
          root.x = x
          root.y = y
          s.doc.rootIds.push(result.rootId)
          if (!s.doc.data || typeof s.doc.data !== 'object' || Array.isArray(s.doc.data)) s.doc.data = {}
          const target = s.doc.data as Record<string, unknown>
          for (const [key, value] of Object.entries(result.collections)) target[key] = value
          s.selection = [result.rootId]
        })

        const { layerCount, collectionNames } = result.stats
        let message = `Imported ${layerCount} layer${layerCount === 1 ? '' : 's'}`
        if (collectionNames.length) {
          const parts = collectionNames.map(
            (name) => `“${name}” (${result.collections[name]?.length ?? 0} items)`,
          )
          message += ` · extracted ${parts.join(', ')} into Data, wired to ${
            collectionNames.length > 1 ? 'repeaters' : 'a repeater'
          }`
        }
        state.setToast(message)
        return { ok: true, message }
      },
    }
  }),
)

// ---- persistence ----
let saveTimer: ReturnType<typeof setTimeout> | null = null
useStore.subscribe((state, prev) => {
  if (state.doc === prev.doc) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.doc))
    } catch {
      // storage full / unavailable — persistence is best-effort
    }
  }, 400)
})

// ---- derived helpers (pure, operate on current doc) ----

/** Walk up from a node to find the enclosing collection-bound repeater's path. */
export function enclosingCollectionPath(doc: DesignDoc, id: NodeId): string | undefined {
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur) {
    if (cur.type === 'frame' && cur.repeat?.mode === 'collection') return cur.repeat.path
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined
  }
  // A component definition's text nodes are also used inside instances that may
  // sit in repeaters; the instance context supplies `item` at render time.
  return undefined
}

/** Walk up to find the enclosing component definition, if any. */
export function enclosingComponent(doc: DesignDoc, id: NodeId): FrameNode | undefined {
  let cur: AnyNode | undefined = doc.nodes[id]
  while (cur) {
    if (cur.type === 'frame' && cur.isComponent) return cur
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined
  }
  return undefined
}

/** Whether the node is positioned by its parent's auto layout. */
export function isAutoChild(doc: DesignDoc, id: NodeId): boolean {
  const node = doc.nodes[id]
  if (!node?.parentId) return false
  const p = doc.nodes[node.parentId]
  return p?.type === 'frame' && !!p.autoLayout
}

export function listComponents(doc: DesignDoc): FrameNode[] {
  return Object.values(doc.nodes).filter(
    (n): n is FrameNode => n.type === 'frame' && !!n.isComponent,
  )
}
