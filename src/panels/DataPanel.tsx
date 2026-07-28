import { useEffect, useState } from 'react'
import { SEED_DATA } from '../model/seed'
import { useStore } from '../store'

/**
 * Edit the JSON data source that bindings and collection repeaters read from.
 * Illustrates how CMS content could drive a design.
 */
export function DataPanel() {
  const data = useStore((s) => s.doc.data)
  const setData = useStore((s) => s.setData)
  const [text, setText] = useState(() => JSON.stringify(data, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Reflect external changes (undo/redo, reset) when not mid-edit.
  useEffect(() => {
    if (!dirty) {
      setText(JSON.stringify(data, null, 2))
      setError(null)
    }
  }, [data, dirty])

  const apply = () => {
    try {
      const parsed = JSON.parse(text)
      setData(parsed)
      setDirty(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  return (
    <div className="data-panel">
      <div className="data-hint">
        Bind text frames to paths in this JSON (like a CMS). Repeaters can bind to arrays — try
        setting <code>articles</code> to <code>[]</code> to see the empty state.
      </div>
      <textarea
        className="data-editor"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
      />
      {error && <div className="data-error">{error}</div>}
      <div className="data-actions">
        <button className="btn btn-primary" onClick={apply} disabled={!dirty}>
          Apply
        </button>
        <button
          className="btn"
          onClick={() => {
            try {
              setText(JSON.stringify(JSON.parse(text), null, 2))
              setError(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid JSON')
            }
          }}
        >
          Format
        </button>
        <button
          className="btn"
          title="Restore the sample dataset"
          onClick={() => {
            setData(structuredClone(SEED_DATA))
            setDirty(false)
          }}
        >
          Reset data
        </button>
      </div>
    </div>
  )
}
