import { Component, Plus } from 'lucide-react'
import { listComponents, useStore } from '../store'

export function AssetsPanel() {
  const doc = useStore((s) => s.doc)
  const insertInstance = useStore((s) => s.insertInstance)
  const select = useStore((s) => s.select)
  const components = listComponents(doc)

  const insertAtCenter = (componentId: string) => {
    const v = useStore.getState().viewport
    const el = document.querySelector('.canvas-container')
    const r = el?.getBoundingClientRect()
    const cx = r ? (r.width / 2 - v.x) / v.zoom - 140 : 100
    const cy = r ? (r.height / 2 - v.y) / v.zoom - 80 : 100
    insertInstance(componentId, Math.round(cx), Math.round(cy))
  }

  return (
    <div className="assets-panel">
      {components.length === 0 && (
        <div className="insp-hint" style={{ padding: 12 }}>
          No components yet. Select a frame and use “Create component” in the inspector.
        </div>
      )}
      {components.map((c) => (
        <div key={c.id} className="asset-row">
          <Component size={13} className="icon-component" />
          <button className="asset-name" title="Select the definition" onClick={() => select([c.id])}>
            {c.name}
            <span className="asset-meta">{(c.props ?? []).length} props</span>
          </button>
          <button className="btn btn-component" onClick={() => insertAtCenter(c.id)}>
            <Plus size={12} /> Insert
          </button>
        </div>
      ))}
    </div>
  )
}
