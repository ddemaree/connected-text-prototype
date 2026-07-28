import { ChevronDown, ChevronRight, Component, Diamond, Frame, Repeat2, Type } from 'lucide-react'
import { useState } from 'react'
import type { AnyNode, NodeId } from '../model/types'
import { useStore } from '../store'

function NodeIcon({ node }: { node: AnyNode }) {
  if (node.type === 'text') return <Type size={12} className="layer-icon" />
  if (node.type === 'instance') return <Diamond size={12} className="layer-icon icon-component" />
  if (node.isComponent) return <Component size={12} className="layer-icon icon-component" />
  if (node.repeat) return <Repeat2 size={12} className="layer-icon icon-repeater" />
  return <Frame size={12} className="layer-icon" />
}

function sourceDot(node: AnyNode): string | null {
  if (node.type !== 'text') return null
  switch (node.content.type) {
    case 'binding':
      return 'dot-binding'
    case 'generator':
      return 'dot-generator'
    case 'prop':
      return 'dot-prop'
    default:
      return null
  }
}

function LayerRow({ id, depth }: { id: NodeId; depth: number }) {
  const node = useStore((s) => s.doc.nodes[id])
  const selected = useStore((s) => s.selection.includes(id))
  const hovered = useStore((s) => s.hoveredId === id)
  const select = useStore((s) => s.select)
  const setHovered = useStore((s) => s.setHovered)
  const renameNode = useStore((s) => s.renameNode)
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  if (!node) return null

  const children = node.type === 'frame' ? node.children : []
  const dot = sourceDot(node)
  const repeatBadge =
    node.type === 'frame' && node.repeat ? (node.repeat.mode === 'collection' ? node.repeat.path : `×${node.repeat.count}`) : null

  return (
    <>
      <div
        className={`layer-row ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => select([id], e.shiftKey)}
        onDoubleClick={() => setRenaming(true)}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
      >
        {children.length > 0 ? (
          <button
            className="layer-chevron"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed(!collapsed)
            }}
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </button>
        ) : (
          <span className="layer-chevron" />
        )}
        <NodeIcon node={node} />
        {renaming ? (
          <input
            className="layer-rename"
            autoFocus
            defaultValue={node.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameNode(id, e.target.value || node.name)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className={`layer-name ${node.type === 'frame' && node.isComponent ? 'name-component' : ''}`}>
            {node.name}
          </span>
        )}
        {dot && <span className={`layer-dot ${dot}`} title="Connected text" />}
        {repeatBadge && <span className="layer-repeat-badge">⟳ {repeatBadge}</span>}
      </div>
      {!collapsed && children.map((c) => <LayerRow key={c} id={c} depth={depth + 1} />)}
    </>
  )
}

export function LayersPanel() {
  const rootIds = useStore((s) => s.doc.rootIds)
  return (
    <div className="layers-panel">
      {rootIds.map((id) => (
        <LayerRow key={id} id={id} depth={0} />
      ))}
    </div>
  )
}
