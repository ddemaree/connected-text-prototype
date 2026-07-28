import { useEffect } from 'react'
import './devmode.css'
import { Canvas } from './editor/Canvas'
import { DEFAULT_AUTO_LAYOUT } from './model/types'
import { AssetsPanel } from './panels/AssetsPanel'
import { DataPanel } from './panels/DataPanel'
import { DevPanel } from './panels/DevPanel'
import { Inspector } from './panels/Inspector'
import { LayersPanel } from './panels/LayersPanel'
import { Toolbar } from './panels/Toolbar'
import { useStore, type LeftTab } from './store'

const LEFT_TABS: { value: LeftTab; label: string }[] = [
  { value: 'layers', label: 'Layers' },
  { value: 'data', label: 'Data' },
  { value: 'assets', label: 'Components' },
]

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      const state = useStore.getState()
      const mod = e.metaKey || e.ctrlKey

      // Shift+D toggles Dev Mode — ignored mid text edit (⌘D still duplicates).
      if (!mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        if (state.editingId) return
        e.preventDefault()
        state.setMode(state.mode === 'dev' ? 'design' : 'dev')
        return
      }
      // Escape only clears selection, so it works in either mode.
      if (e.key === 'Escape') {
        state.select([])
        if (state.mode === 'design') state.setTool('select')
        return
      }
      // Dev mode is inspect-only: nothing below this line may touch the document.
      if (state.mode === 'dev') return

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (state.selection.length) state.duplicateNodes(state.selection)
        return
      }
      if (mod) return

      switch (e.key) {
        case 'v':
        case 'V':
          if (!e.shiftKey) state.setTool('select')
          break
        case 'f':
        case 'F':
          if (!e.shiftKey) state.setTool('frame')
          break
        case 't':
        case 'T':
          if (!e.shiftKey) state.setTool('text')
          break
        case 'a':
        case 'A':
          if (e.shiftKey && state.selection.length === 1) {
            const node = state.doc.nodes[state.selection[0]]
            if (node?.type === 'frame') {
              e.preventDefault()
              state.setAutoLayout(node.id, node.autoLayout ? null : { ...DEFAULT_AUTO_LAYOUT })
            }
          }
          break
        case 'Delete':
        case 'Backspace':
          if (state.selection.length) {
            e.preventDefault()
            state.deleteNodes(state.selection)
          }
          break
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!state.selection.length) break
          e.preventDefault()
          const d = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
          state.pushHistory()
          state.moveNodesBy(state.selection, dx, dy)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Pasting markup anywhere outside a field imports it onto the canvas. */
function usePasteImport() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) return
      const state = useStore.getState()
      if (state.editingId || state.mode === 'dev') return
      let html = e.clipboardData?.getData('text/html') ?? ''
      if (!html.trim()) {
        const plain = e.clipboardData?.getData('text/plain') ?? ''
        if (plain.trimStart().startsWith('<')) html = plain
      }
      if (!html.trim()) return
      e.preventDefault()
      state.importHtmlMarkup(html)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

export default function App() {
  useKeyboardShortcuts()
  usePasteImport()
  const leftTab = useStore((s) => s.leftTab)
  const setLeftTab = useStore((s) => s.setLeftTab)
  const devMode = useStore((s) => s.mode === 'dev')

  return (
    <div className={`app ${devMode ? 'is-dev' : ''}`}>
      <Toolbar />
      <div className="app-body">
        <div className="left-panel">
          <div className="panel-tabs">
            {LEFT_TABS.map((t) => (
              <button
                key={t.value}
                className={`panel-tab ${leftTab === t.value ? 'active' : ''}`}
                onClick={() => setLeftTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="left-panel-content">
            {leftTab === 'layers' && <LayersPanel />}
            {leftTab === 'data' && <DataPanel />}
            {leftTab === 'assets' && <AssetsPanel />}
          </div>
        </div>
        <Canvas />
        <div className="right-panel">{devMode ? <DevPanel /> : <Inspector />}</div>
      </div>
    </div>
  )
}
