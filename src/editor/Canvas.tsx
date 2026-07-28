import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeId } from '../model/types'
import { isAutoChild, useStore } from '../store'
import { InteractionContext, useInteraction, type InteractionApi } from './interaction'
import { NodeView } from './RenderNode'
import { SelectionOverlay } from './SelectionOverlay'

interface DraftRect {
  x: number
  y: number
  w: number
  h: number
}

type DragState =
  | { kind: 'pan'; startClientX: number; startClientY: number; startVx: number; startVy: number }
  | {
      kind: 'move'
      id: NodeId
      ids: NodeId[]
      startClientX: number
      startClientY: number
      startPositions: Map<NodeId, { x: number; y: number }>
      auto: boolean
      parentId: NodeId | null
      started: boolean
    }
  | {
      kind: 'draw'
      startClientX: number
      startClientY: number
      parentId: NodeId | null
      parentLeft: number
      parentTop: number
    }

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewport = useStore((s) => s.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const tool = useStore((s) => s.tool)
  const rootIds = useStore((s) => s.doc.rootIds)
  const select = useStore((s) => s.select)
  const toast = useStore((s) => s.toast)

  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  // --- coordinate helpers ---
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const v = useStore.getState().viewport
    return {
      x: (clientX - rect.left - v.x) / v.zoom,
      y: (clientY - rect.top - v.y) / v.zoom,
    }
  }, [])

  // --- wheel: pan / zoom (non-passive so we can preventDefault) ---
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = useStore.getState().viewport
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const zoom = Math.min(4, Math.max(0.08, v.zoom * Math.exp(-e.deltaY * 0.0022)))
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const wx = (px - v.x) / v.zoom
        const wy = (py - v.y) / v.zoom
        useStore.getState().setViewport({ x: px - wx * zoom, y: py - wy * zoom, zoom })
      } else {
        useStore.getState().setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // --- space key for pan mode ---
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) =>
      (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]') != null
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        setSpaceDown(true)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // --- shared drag plumbing ---
  const endDrag = useCallback(() => {
    dragRef.current = null
    setPanning(false)
    setDraft(null)
    window.removeEventListener('pointermove', onWindowMove)
    window.removeEventListener('pointerup', onWindowUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWindowMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const state = useStore.getState()
    const v = state.viewport

    if (drag.kind === 'pan') {
      state.setViewport({
        x: drag.startVx + (e.clientX - drag.startClientX),
        y: drag.startVy + (e.clientY - drag.startClientY),
        zoom: v.zoom,
      })
      return
    }

    if (drag.kind === 'move') {
      const dxScreen = e.clientX - drag.startClientX
      const dyScreen = e.clientY - drag.startClientY
      if (!drag.started) {
        if (Math.abs(dxScreen) < 3 && Math.abs(dyScreen) < 3) return
        drag.started = true
        state.pushHistory()
      }
      if (drag.auto && drag.parentId) {
        // Reorder within the parent's auto layout by pointer position.
        const parentNode = state.doc.nodes[drag.parentId]
        if (parentNode?.type !== 'frame' || !parentNode.autoLayout) return
        const parentEl = document.querySelector(`[data-node-id="${drag.parentId}"]`)
        if (!parentEl) return
        const isRow = parentNode.autoLayout.direction === 'row'
        const wrap = parentNode.autoLayout.wrap
        const childEls = [...parentEl.children].filter(
          (c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.nodeId,
        )
        let target = 0
        for (const el of childEls) {
          if (el.dataset.nodeId === drag.id) continue
          const r = el.getBoundingClientRect()
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          const before = isRow
            ? wrap
              ? cy < e.clientY - r.height / 2 || (Math.abs(cy - e.clientY) <= r.height / 2 && cx < e.clientX)
              : cx < e.clientX
            : cy < e.clientY
          if (before) target++
        }
        const from = parentNode.children.indexOf(drag.id)
        if (from !== -1 && from !== target) state.moveChild(drag.parentId, from, target)
      } else {
        const dx = dxScreen / v.zoom
        const dy = dyScreen / v.zoom
        for (const id of drag.ids) {
          const start = drag.startPositions.get(id)
          if (!start) continue
          state.patchNodeTransient(id, { x: Math.round(start.x + dx), y: Math.round(start.y + dy) })
        }
      }
      return
    }

    if (drag.kind === 'draw') {
      const a = toWorldRef.current(drag.startClientX, drag.startClientY)
      const b = toWorldRef.current(e.clientX, e.clientY)
      setDraft({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWindowUp = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    const state = useStore.getState()
    if (drag?.kind === 'draw') {
      const v = state.viewport
      const zoom = v.zoom
      const dx = Math.abs(e.clientX - drag.startClientX)
      const dy = Math.abs(e.clientY - drag.startClientY)
      const clicked = dx < 4 && dy < 4
      // Position relative to the target parent frame (or the world).
      const relX = (Math.min(drag.startClientX, e.clientX) - drag.parentLeft) / zoom
      const relY = (Math.min(drag.startClientY, e.clientY) - drag.parentTop) / zoom
      const w = dx / zoom
      const h = dy / zoom
      if (state.tool === 'frame') {
        if (clicked) state.addFrameAt(drag.parentId, Math.round(relX), Math.round(relY), 160, 120)
        else state.addFrameAt(drag.parentId, Math.round(relX), Math.round(relY), Math.round(w), Math.round(h))
      } else if (state.tool === 'text') {
        if (clicked) state.addTextAt(drag.parentId, Math.round(relX), Math.round(relY))
        else state.addTextAt(drag.parentId, Math.round(relX), Math.round(relY), Math.round(Math.max(40, w)))
      }
    }
    endDrag()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toWorldRef = useRef(toWorld)
  toWorldRef.current = toWorld

  const beginWindowDrag = useCallback(
    (drag: DragState) => {
      dragRef.current = drag
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
    },
    [onWindowMove, onWindowUp],
  )

  // --- container pointer handlers ---
  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const state = useStore.getState()
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        e.preventDefault()
        setPanning(true)
        const v = state.viewport
        beginWindowDrag({
          kind: 'pan',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startVx: v.x,
          startVy: v.y,
        })
        return
      }
      if (e.button !== 0) return

      if (state.tool === 'frame' || state.tool === 'text') {
        // Find the deepest frame under the pointer that can accept children.
        let parentId: NodeId | null = null
        let parentLeft = 0
        let parentTop = 0
        const els = document.elementsFromPoint(e.clientX, e.clientY)
        for (const el of els) {
          const id = (el as HTMLElement).dataset?.nodeId
          if (!id) continue
          const node = state.doc.nodes[id]
          if (node?.type === 'frame' && !node.repeat) {
            parentId = id
            const r = el.getBoundingClientRect()
            parentLeft = r.left
            parentTop = r.top
            break
          }
        }
        if (!parentId) {
          const rect = containerRef.current!.getBoundingClientRect()
          const v = state.viewport
          parentLeft = rect.left + v.x
          parentTop = rect.top + v.y
        }
        beginWindowDrag({
          kind: 'draw',
          startClientX: e.clientX,
          startClientY: e.clientY,
          parentId,
          parentLeft,
          parentTop,
        })
        return
      }

      // Select tool on empty canvas: clear selection.
      if (!e.shiftKey) select([])
    },
    [beginWindowDrag, select, spaceDown],
  )

  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, id: NodeId) => {
      const state = useStore.getState()
      if (state.tool !== 'select') return // bubble up to the draw handler
      if (e.button === 1) return // bubble up so middle-drag pans
      if (e.button !== 0) return
      if (spaceDown) return // bubble up to pan
      e.stopPropagation()
      if (state.editingId && state.editingId !== id) {
        // Clicking outside the edited text: the blur handler commits it.
      }
      if (e.shiftKey) {
        state.select([id], true)
        return
      }
      const selection = state.selection.includes(id) ? state.selection : [id]
      state.select(selection)

      const auto = isAutoChild(state.doc, id)
      const node = state.doc.nodes[id]
      const startPositions = new Map<NodeId, { x: number; y: number }>()
      const movable = auto ? [id] : selection.filter((sid) => !isAutoChild(state.doc, sid))
      for (const sid of movable) {
        const n = state.doc.nodes[sid]
        if (n) startPositions.set(sid, { x: n.x, y: n.y })
      }
      beginWindowDrag({
        kind: 'move',
        id,
        ids: movable,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPositions,
        auto,
        parentId: node?.parentId ?? null,
        started: false,
      })
    },
    [beginWindowDrag, spaceDown],
  )

  const interaction = useMemo<InteractionApi>(() => ({ onNodePointerDown }), [onNodePointerDown])

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : tool !== 'select' ? 'crosshair' : 'default'

  return (
    <InteractionContext.Provider value={interaction}>
      <div
        ref={containerRef}
        className="canvas-container"
        style={{
          cursor,
          backgroundImage: 'radial-gradient(circle, #2e2e2e 1px, transparent 1px)',
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={onContainerPointerDown}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {rootIds.map((id) => (
            <NodeView key={id} id={id} ctx={{}} isRootLevel />
          ))}
          <RootLabels />
          {draft && (
            <div
              style={{
                position: 'absolute',
                left: draft.x,
                top: draft.y,
                width: draft.w,
                height: draft.h,
                border: `${1.5 / viewport.zoom}px solid var(--accent)`,
                background: 'rgba(77, 155, 255, 0.08)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
        <SelectionOverlay containerRef={containerRef} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    </InteractionContext.Provider>
  )
}

/** Frame names shown above top-level frames, Figma-style (constant screen size). */
function RootLabels() {
  const rootIds = useStore((s) => s.doc.rootIds)
  const nodes = useStore((s) => s.doc.nodes)
  const zoom = useStore((s) => s.viewport.zoom)
  const { onNodePointerDown } = useInteraction()
  return (
    <>
      {rootIds.map((id) => {
        const node = nodes[id]
        if (!node) return null
        const isComponent = node.type === 'frame' && node.isComponent
        const isRepeater = node.type === 'frame' && !!node.repeat
        const isInstance = node.type === 'instance'
        return (
          <div
            key={id}
            className={
              'root-label' + (isComponent || isInstance ? ' root-label-component' : isRepeater ? ' root-label-repeater' : '')
            }
            style={{
              left: node.x,
              top: node.y,
              transform: `translateY(-100%) scale(${1 / zoom})`,
              transformOrigin: 'left bottom',
            }}
            onPointerDown={(e) => onNodePointerDown(e, id)}
          >
            {isComponent ? '❖ ' : isInstance ? '◇ ' : isRepeater ? '⟳ ' : ''}
            {node.name}
          </div>
        )
      })}
    </>
  )
}

