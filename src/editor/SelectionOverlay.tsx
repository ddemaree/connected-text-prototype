import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnyNode, NodeId } from '../model/types'
import { isAutoChild, useStore } from '../store'

interface ScreenRect {
  id: NodeId
  left: number
  top: number
  width: number
  height: number
}

interface OverlayState {
  selected: ScreenRect[]
  hovered: ScreenRect | null
}

const HANDLES = [
  { key: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { key: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { key: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { key: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { key: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { key: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { key: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { key: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
] as const

type HandleKey = (typeof HANDLES)[number]['key']

function outlineClass(node: AnyNode | undefined): string {
  if (!node) return ''
  if (node.type === 'instance') return 'is-component'
  if (node.type === 'frame' && node.isComponent) return 'is-component'
  if (node.type === 'frame' && node.repeat) return 'is-repeater'
  return ''
}

function contentChip(node: AnyNode | undefined): { label: string; cls: string } | null {
  if (!node || node.type !== 'text') return null
  const c = node.content
  switch (c.type) {
    case 'static':
      return null
    case 'binding':
      return { label: `{ } ${c.path}`, cls: 'chip-binding' }
    case 'generator':
      return { label: `⚡ ${c.config.kind} · ${c.config.count} ${c.config.unit}`, cls: 'chip-generator' }
    case 'prop':
      return { label: `◇ ${c.prop}`, cls: 'chip-prop' }
  }
}

export function SelectionOverlay({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState<OverlayState>({ selected: [], hovered: null })
  const stateRef = useRef(state)
  stateRef.current = state

  // Continuous measurement: cheap for a handful of rects, robust to reflow.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const container = containerRef.current
      if (!container) return
      const crect = container.getBoundingClientRect()
      const { selection, hoveredId, editingId } = useStore.getState()
      const measure = (id: NodeId): ScreenRect | null => {
        const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { id, left: r.left - crect.left, top: r.top - crect.top, width: r.width, height: r.height }
      }
      const selected = selection.map(measure).filter((r): r is ScreenRect => !!r)
      const hovered =
        hoveredId && !selection.includes(hoveredId) && hoveredId !== editingId ? measure(hoveredId) : null
      const next: OverlayState = { selected, hovered }
      if (JSON.stringify(next) !== JSON.stringify(stateRef.current)) setState(next)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [containerRef])

  const nodes = useStore((s) => s.doc.nodes)
  const zoom = useStore((s) => s.viewport.zoom)
  const editingId = useStore((s) => s.editingId)
  const single = state.selected.length === 1 ? state.selected[0] : null
  const singleNode = single ? nodes[single.id] : undefined

  const beginResize = useCallback(
    (e: React.PointerEvent, handle: HandleKey) => {
      if (!single || !singleNode) return
      e.stopPropagation()
      e.preventDefault()
      const store = useStore.getState()
      store.pushHistory()
      const id = single.id
      const startClientX = e.clientX
      const startClientY = e.clientY
      const startW = single.width / zoom
      const startH = single.height / zoom
      const node = store.doc.nodes[id]
      const startX = node.x
      const startY = node.y
      const auto = isAutoChild(store.doc, id)
      const affectsW = handle.includes('e') || handle.includes('w')
      const affectsH = handle.includes('n') || handle.includes('s')
      const signW = handle.includes('w') ? -1 : 1
      const signH = handle.includes('n') ? -1 : 1

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startClientX) / zoom
        const dy = (ev.clientY - startClientY) / zoom
        const patch: Record<string, unknown> = {}
        if (affectsW) {
          const w = Math.max(8, Math.round(startW + dx * signW))
          patch.width = w
          patch.widthMode = 'fixed'
          if (!auto && handle.includes('w')) patch.x = Math.round(startX + (startW - w))
        }
        if (affectsH) {
          const h = Math.max(8, Math.round(startH + dy * signH))
          patch.height = h
          patch.heightMode = 'fixed'
          if (!auto && handle.includes('n')) patch.y = Math.round(startY + (startH - h))
        }
        useStore.getState().patchNodeTransient(id, patch)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [single, singleNode, zoom],
  )

  return (
    <div className="overlay-layer">
      {state.hovered && (
        <div
          className={`hover-outline ${outlineClass(nodes[state.hovered.id])}`}
          style={{
            left: state.hovered.left,
            top: state.hovered.top,
            width: state.hovered.width,
            height: state.hovered.height,
          }}
        />
      )}
      {state.selected.map((r) => {
        const node = nodes[r.id]
        const chip = contentChip(node)
        const isEditing = editingId === r.id
        return (
          <div
            key={r.id}
            className={`selection-outline ${outlineClass(node)} ${isEditing ? 'is-editing' : ''}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          >
            <div className="selection-name">
              {node?.name ?? ''}
              {chip && <span className={`content-chip ${chip.cls}`}>{chip.label}</span>}
            </div>
            {!isEditing && state.selected.length === 1 && (
              <>
                {HANDLES.map((h) => (
                  <div
                    key={h.key}
                    className="resize-handle"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      cursor: h.cursor,
                    }}
                    onPointerDown={(e) => beginResize(e, h.key)}
                  />
                ))}
                <div className="size-badge">
                  {Math.round(r.width / zoom)} × {Math.round(r.height / zoom)}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
