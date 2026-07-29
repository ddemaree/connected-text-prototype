import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { getByPath, instanceFieldValues, resolveText } from '../model/resolve'
import type {
  AnyNode,
  AutoLayout,
  FrameNode,
  InstanceNode,
  NodeId,
  RenderContext,
  TextNode,
} from '../model/types'
import { useStore } from '../store'
import { hashId, useInteraction } from './interaction'

const FONT_STACKS: Record<TextNode['style']['fontFamily'], string> = {
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
}

export interface ContentChip {
  label: string
  cls: string
}

/**
 * The chip shown for a text layer: only fields get one, labeled with the
 * field's name. Placeholder (connection 'none') gets the hollow variant —
 * marked, but nothing wired yet; generator/binding get their usual colors.
 * Plain text carries no field, so no chip.
 */
export function contentChip(node: AnyNode | undefined): ContentChip | null {
  if (!node || node.type !== 'text' || !node.field) return null
  const label = `⌁ ${node.field.name}`
  switch (node.field.connection.type) {
    case 'none':
      return { label, cls: 'chip-field' }
    case 'binding':
      return { label, cls: 'chip-binding' }
    case 'generator':
      return { label, cls: 'chip-generator' }
  }
}

const ALIGN_MAP = { start: 'flex-start', center: 'center', end: 'flex-end' } as const
const JUSTIFY_MAP = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const

/** CSS for a node's own box, given how its parent lays it out. */
function sizingStyle(node: AnyNode, parentLayout: AutoLayout | null, isRootLevel: boolean): CSSProperties {
  const style: CSSProperties = {}
  const isText = node.type === 'text'
  const hugWidth = isText ? 'max-content' : 'fit-content'

  if (parentLayout && !isRootLevel) {
    const row = parentLayout.direction === 'row'
    // width
    if (node.widthMode === 'fixed') {
      style.width = node.width
      if (row) style.flexShrink = 0
    } else if (node.widthMode === 'hug') {
      style.width = hugWidth
      if (row) style.flexShrink = 0
    } else {
      // fill
      if (row) {
        style.flexGrow = 1
        style.flexBasis = 0
        style.minWidth = 0
      } else {
        style.alignSelf = 'stretch'
        style.minWidth = 0
      }
    }
    // height
    if (node.heightMode === 'fixed') {
      style.height = node.height
      if (!row) style.flexShrink = 0
    } else if (node.heightMode === 'hug') {
      style.height = 'fit-content'
    } else {
      if (!row) {
        style.flexGrow = 1
        style.flexBasis = 0
        style.minHeight = 0
      } else {
        style.alignSelf = 'stretch'
        style.minHeight = 0
      }
    }
  } else {
    style.position = 'absolute'
    style.left = node.x
    style.top = node.y
    style.width = node.widthMode === 'hug' ? hugWidth : node.width
    style.height = node.heightMode === 'hug' ? 'fit-content' : node.height
  }
  return style
}

function frameBoxStyle(node: FrameNode): CSSProperties {
  const style: CSSProperties = {
    borderRadius: node.cornerRadius,
    background: node.fill ?? 'transparent',
    overflow: node.clip ? 'hidden' : 'visible',
    boxSizing: 'border-box',
  }
  const shadows: string[] = []
  if (node.stroke) shadows.push(`inset 0 0 0 ${node.strokeWidth}px ${node.stroke}`)
  if (node.shadow) shadows.push('0 2px 6px rgba(20,18,12,0.08), 0 12px 32px rgba(20,18,12,0.10)')
  if (shadows.length) style.boxShadow = shadows.join(', ')
  if (node.autoLayout) {
    const al = node.autoLayout
    style.display = 'flex'
    style.flexDirection = al.direction
    style.gap = al.gap
    style.padding = `${al.paddingY}px ${al.paddingX}px`
    style.alignItems = ALIGN_MAP[al.align]
    style.justifyContent = JUSTIFY_MAP[al.justify]
    style.flexWrap = al.wrap ? 'wrap' : 'nowrap'
    if (al.wrap) style.alignContent = 'flex-start'
  } else {
    style.position = 'relative' as const
  }
  if (node.children.length === 0) {
    style.minWidth = 8
    style.minHeight = 8
  }
  return style
}

export interface NodeViewProps {
  id: NodeId
  ctx: RenderContext
  /** Ghosts are visual clones (repeater copies, instance internals): not selectable. */
  ghost?: boolean
  isRootLevel?: boolean
}

export const NodeView = memo(function NodeView({ id, ctx, ghost, isRootLevel }: NodeViewProps) {
  const node = useStore((s) => s.doc.nodes[id])
  const parent = useStore((s) => (node?.parentId ? s.doc.nodes[node.parentId] : undefined))
  if (!node) return null
  const parentLayout = !isRootLevel && parent?.type === 'frame' ? parent.autoLayout : null

  switch (node.type) {
    case 'frame':
      return <FrameView node={node} parentLayout={parentLayout} ctx={ctx} ghost={ghost} isRootLevel={isRootLevel} />
    case 'text':
      return <TextView node={node} parentLayout={parentLayout} ctx={ctx} ghost={ghost} isRootLevel={isRootLevel} />
    case 'instance':
      return <InstanceView node={node} parentLayout={parentLayout} ctx={ctx} ghost={ghost} isRootLevel={isRootLevel} />
  }
})

interface ViewProps<T extends AnyNode> {
  node: T
  parentLayout: AutoLayout | null
  ctx: RenderContext
  ghost?: boolean
  isRootLevel?: boolean
}

function useNodeEvents(id: NodeId, ghost: boolean | undefined) {
  const interaction = useInteraction()
  const setHovered = useStore((s) => s.setHovered)
  if (ghost) return {}
  return {
    onPointerDown: (e: React.PointerEvent) => interaction.onNodePointerDown(e, id),
    onPointerOver: (e: React.PointerEvent) => {
      e.stopPropagation()
      setHovered(id)
    },
    onPointerOut: () => {
      const cur = useStore.getState().hoveredId
      if (cur === id) setHovered(null)
    },
  }
}

function FrameView({ node, parentLayout, ctx, ghost, isRootLevel }: ViewProps<FrameNode>) {
  const events = useNodeEvents(node.id, ghost)
  const doc = useStore((s) => s.doc)
  const style: CSSProperties = {
    ...sizingStyle(node, parentLayout, !!isRootLevel),
    ...frameBoxStyle(node),
  }
  if (ghost) style.pointerEvents = 'none'

  // A component definition rendered directly on canvas (not through an
  // instance) needs no special context: its fields' own connections ARE the
  // definition's defaults, so they resolve the same way plain fields do.
  let childContent: React.ReactNode
  if (node.repeat && node.children.length > 0) {
    const templateId = node.children[0]
    const emptyId = node.children[1]
    let items: unknown[]
    if (node.repeat.mode === 'count') {
      items = Array.from({ length: Math.max(0, Math.min(100, node.repeat.count)) }, () => undefined)
    } else {
      const v = getByPath(doc.data, node.repeat.path, ctx)
      items = Array.isArray(v) ? v : []
    }
    if (items.length === 0) {
      childContent = emptyId ? <NodeView key={emptyId} id={emptyId} ctx={ctx} ghost={ghost} /> : null
    } else {
      childContent = items.map((item, i) => (
        <NodeView
          key={i === 0 ? templateId : `${templateId}::${i}`}
          id={templateId}
          ctx={{
            ...ctx,
            item: node.repeat!.mode === 'collection' ? item : ctx.item,
            index: i,
            seedOffset: (ctx.seedOffset ?? 0) + i * 101,
          }}
          ghost={ghost || i > 0}
        />
      ))
    }
  } else {
    childContent = node.children.map((c) => <NodeView key={c} id={c} ctx={ctx} ghost={ghost} />)
  }

  return (
    <div data-node-id={ghost ? undefined : node.id} style={style} {...events}>
      {childContent}
    </div>
  )
}

function TextView({ node, parentLayout, ctx, ghost, isRootLevel }: ViewProps<TextNode>) {
  const events = useNodeEvents(node.id, ghost)
  const { devMode } = useInteraction()
  const doc = useStore((s) => s.doc)
  // Chips keep a constant screen size; only dev mode subscribes to zoom.
  const chipScale = useStore((s) => (s.mode === 'dev' ? 1 / s.viewport.zoom : 1))
  const editing = useStore((s) => s.editingId === node.id && !ghost)
  const setEditing = useStore((s) => s.setEditing)
  const select = useStore((s) => s.select)
  const commitTextEdit = useStore((s) => s.commitTextEdit)
  const setToast = useStore((s) => s.setToast)
  const editRef = useRef<HTMLDivElement | null>(null)

  const resolved = resolveText(node, doc, ctx)
  // Plain text and placeholder fields are the layer's own text, so they're
  // editable in place; a live connection owns the value instead.
  const editable = !node.field || node.field.connection.type === 'none'

  const s = node.style
  const style: CSSProperties = {
    ...sizingStyle(node, parentLayout, !!isRootLevel),
    fontFamily: FONT_STACKS[s.fontFamily],
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    color: s.color,
    textAlign: s.textAlign,
    textTransform: s.uppercase ? 'uppercase' : 'none',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    cursor: editing ? 'text' : undefined,
  }
  if (node.heightMode === 'fixed') style.overflow = 'hidden'
  if (ghost) style.pointerEvents = 'none'
  if (resolved.missing) style.opacity = 0.45

  // Dev mode shows annotations by default, like Figma's inspect view.
  const chip = devMode && !ghost ? contentChip(node) : null
  if (chip && style.position !== 'absolute') style.position = 'relative'

  useLayoutEffect(() => {
    if (editing && editRef.current) {
      editRef.current.innerText = resolved.text
      editRef.current.focus()
      const range = document.createRange()
      range.selectNodeContents(editRef.current)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (editing) {
    return (
      <div
        data-node-id={node.id}
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        style={{ ...style, outline: 'none', userSelect: 'text' }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            commitTextEdit(node.id, editRef.current?.innerText ?? '')
          }
        }}
        onBlur={() => commitTextEdit(node.id, editRef.current?.innerText ?? '')}
      />
    )
  }

  return (
    <div
      data-node-id={ghost ? undefined : node.id}
      style={style}
      {...events}
      onDoubleClick={
        ghost || devMode
          ? undefined
          : (e) => {
              e.stopPropagation()
              select([node.id])
              if (editable) {
                setEditing(node.id)
              } else {
                const connection = node.field!.connection
                const label = connection.type === 'binding' ? `data path “${connection.path}”` : 'a text generator'
                setToast(
                  `This text is connected to ${label} — disconnect it in the Content panel to edit the placeholder.`,
                )
              }
            }
      }
    >
      {chip && (
        <span
          className={`dev-chip content-chip ${chip.cls}`}
          // Straddle the text's top edge so tight stacks stay legible under it.
          style={{ transform: `translateY(-55%) scale(${chipScale})` }}
        >
          {chip.label}
        </span>
      )}
      {resolved.missing ? `⚠ ${resolved.text}` : resolved.text || ' '}
    </div>
  )
}

function InstanceView({ node, parentLayout, ctx, ghost, isRootLevel }: ViewProps<InstanceNode>) {
  const events = useNodeEvents(node.id, ghost)
  const doc = useStore((s) => s.doc)
  const def = doc.nodes[node.componentId]

  if (!def || def.type !== 'frame') {
    return (
      <div
        data-node-id={ghost ? undefined : node.id}
        style={{
          ...sizingStyle(node, parentLayout, !!isRootLevel),
          minHeight: 40,
          border: '1px dashed #c33',
          color: '#c33',
          fontSize: 12,
          padding: 8,
        }}
        {...events}
      >
        Missing component
      </div>
    )
  }

  // Only the fields this instance actually overrides get a value here — the
  // rest fall through to their own definition connection, resolved in this
  // same context so `item.*` bindings and generator variance still apply.
  const innerCtx: RenderContext = { ...ctx, seedOffset: (ctx.seedOffset ?? 0) + hashId(node.id) }
  const fieldValues = instanceFieldValues(doc, node, innerCtx)

  // The wrapper takes the instance's sizing but the definition's visual style.
  const style: CSSProperties = {
    ...sizingStyle(node, parentLayout, !!isRootLevel),
    ...frameBoxStyle(def),
  }
  if (ghost) style.pointerEvents = 'none'

  return (
    <div data-node-id={ghost ? undefined : node.id} style={style} {...events}>
      {def.children.map((c) => (
        <NodeView key={c} id={c} ctx={{ ...innerCtx, fieldValues }} ghost />
      ))}
    </div>
  )
}
