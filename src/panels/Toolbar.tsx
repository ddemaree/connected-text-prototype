import { CodeXml, FileCode2, Frame, MousePointer2, Redo2, RotateCcw, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EXAMPLE_HTML } from '../model/htmlImport'
import { useStore, type Tool } from '../store'

const TOOLS: { value: Tool; icon: React.ReactNode; title: string }[] = [
  { value: 'select', icon: <MousePointer2 size={15} />, title: 'Select / move (V)' },
  { value: 'frame', icon: <Frame size={15} />, title: 'Frame — drag to draw (F)' },
  { value: 'text', icon: <Type size={15} />, title: 'Text — click or drag (T)' },
]

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const devMode = useStore((s) => s.mode === 'dev')
  const setMode = useStore((s) => s.setMode)
  const viewport = useStore((s) => s.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const resetDoc = useStore((s) => s.resetDoc)
  const importHtmlMarkup = useStore((s) => s.importHtmlMarkup)
  const [importOpen, setImportOpen] = useState(false)
  const [markup, setMarkup] = useState('')

  useEffect(() => {
    if (!importOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImportOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [importOpen])

  const zoomTo = (zoom: number) => {
    const el = document.querySelector('.canvas-container')
    const r = el?.getBoundingClientRect()
    if (!r) return setViewport({ ...viewport, zoom })
    const cx = r.width / 2
    const cy = r.height / 2
    const wx = (cx - viewport.x) / viewport.zoom
    const wy = (cy - viewport.y) / viewport.zoom
    setViewport({ x: cx - wx * zoom, y: cy - wy * zoom, zoom })
  }

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <span className="brand-mark">▞</span> Frameshift
        <span className="brand-sub">connected text prototype</span>
      </div>

      {!devMode && (
        <div className="toolbar-tools">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              className={`tool-btn ${tool === t.value ? 'active' : ''}`}
              title={t.title}
              onClick={() => setTool(t.value)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar-spacer" />
      <div className="toolbar-hint">
        {devMode
          ? 'inspect only · click a layer to read its content contract · shift+D to exit'
          : 'double-click text to edit · space+drag to pan · ⌘/ctrl+scroll to zoom'}
      </div>
      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button className="tool-btn" title="Undo (⌘Z)" disabled={devMode || !canUndo} onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button className="tool-btn" title="Redo (⇧⌘Z)" disabled={devMode || !canRedo} onClick={redo}>
          <Redo2 size={15} />
        </button>
      </div>

      <div className="toolbar-group">
        <button className="tool-btn" title="Zoom out" onClick={() => zoomTo(Math.max(0.08, viewport.zoom / 1.25))}>
          <ZoomOut size={15} />
        </button>
        <button className="zoom-label" title="Reset to 100%" onClick={() => zoomTo(1)}>
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button className="tool-btn" title="Zoom in" onClick={() => zoomTo(Math.min(4, viewport.zoom * 1.25))}>
          <ZoomIn size={15} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className="tool-btn"
          title="Import HTML — or paste markup on the canvas"
          disabled={devMode}
          onClick={() => setImportOpen(true)}
        >
          <FileCode2 size={15} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className="tool-btn"
          title="Reset the demo document"
          disabled={devMode}
          onClick={() => {
            if (window.confirm('Reset the canvas and data to the demo document?')) resetDoc()
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <button
        className={`dev-mode-toggle ${devMode ? 'active' : ''}`}
        title="Dev Mode — inspect the content schema (Shift+D)"
        onClick={() => setMode(devMode ? 'design' : 'dev')}
      >
        <CodeXml size={14} /> Dev Mode
      </button>

      {importOpen && (
        <div
          className="modal-overlay"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setImportOpen(false)
          }}
        >
          <div className="modal-panel" onPointerDown={(e) => e.stopPropagation()}>
            <div className="modal-title">Import HTML</div>
            <div className="modal-hint">
              Blocks become frames, headings and paragraphs become text. Repeated structures (like a card
              list) become a repeater with the content extracted to Data.
            </div>
            <textarea
              className="field modal-textarea"
              rows={12}
              spellCheck={false}
              autoFocus
              value={markup}
              placeholder="Paste HTML markup here…"
              onChange={(e) => setMarkup(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setMarkup(EXAMPLE_HTML)}>
                Try an example
              </button>
              <div className="modal-actions-spacer" />
              <button className="btn" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!markup.trim()}
                onClick={() => {
                  importHtmlMarkup(markup)
                  setImportOpen(false)
                }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
