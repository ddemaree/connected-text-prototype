import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowRight, Component, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { listCollectionPaths, getByPath } from '../model/resolve'
import {
  DEFAULT_AUTO_LAYOUT,
  type AnyNode,
  type ContentSource,
  type FrameNode,
  type InstanceNode,
  type NodeId,
  type SizeMode,
  type TextNode,
} from '../model/types'
import {
  enclosingCollectionPath,
  enclosingComponent,
  isAutoChild,
  useStore,
} from '../store'
import { ContentSourceEditor } from '../ui/ContentSourceEditor'
import {
  Checkbox,
  ColorField,
  NumberField,
  Row,
  Section,
  Segmented,
  SelectField,
  TextField,
} from '../ui/controls'

export function Inspector() {
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => s.doc.nodes)

  if (selection.length === 0) return <EmptyInspector />
  if (selection.length > 1) return <MultiInspector count={selection.length} />
  const node = nodes[selection[0]]
  if (!node) return <EmptyInspector />

  return (
    <div className="inspector">
      <NameSection node={node} />
      <LayoutSection node={node} />
      {node.type === 'frame' && <AutoLayoutSection node={node} />}
      {node.type === 'frame' && <FrameStyleSection node={node} />}
      {node.type === 'text' && <TextStyleSection node={node} />}
      {node.type === 'text' && <ContentSection node={node} />}
      {node.type === 'frame' && !node.isComponent && !node.repeat && <MakeComponentSection node={node} />}
      {node.type === 'frame' && node.isComponent && <ComponentSection node={node} />}
      {node.type === 'instance' && <InstanceSection node={node} />}
      {node.type === 'frame' && !node.isComponent && <RepeaterSection node={node} />}
    </div>
  )
}

function EmptyInspector() {
  return (
    <div className="inspector inspector-empty">
      <div className="insp-tips">
        <div className="insp-tips-title">Frameshift</div>
        <p>A tiny Figma-style prototype exploring connected text.</p>
        <ul>
          <li><b>V / F / T</b> — select, frame and text tools</li>
          <li><b>Double-click</b> a text frame to edit it</li>
          <li><b>Space + drag</b> pans, <b>⌘/Ctrl + scroll</b> zooms</li>
          <li><b>Shift + A</b> toggles auto layout on a frame</li>
          <li>Select a text frame to connect it to <b>JSON data</b> or a <b>generator</b></li>
          <li>Turn a frame into a <b>component</b>, then bind its props</li>
          <li>Make a frame a <b>repeater</b> to clone its first child from data</li>
        </ul>
      </div>
    </div>
  )
}

function MultiInspector({ count }: { count: number }) {
  const selection = useStore((s) => s.selection)
  const deleteNodes = useStore((s) => s.deleteNodes)
  return (
    <div className="inspector">
      <Section title={`${count} layers selected`}>
        <button className="btn" onClick={() => deleteNodes(selection)}>
          <Trash2 size={13} /> Delete
        </button>
      </Section>
    </div>
  )
}

function NameSection({ node }: { node: AnyNode }) {
  const renameNode = useStore((s) => s.renameNode)
  const kind =
    node.type === 'text'
      ? 'Text'
      : node.type === 'instance'
        ? 'Instance'
        : node.isComponent
          ? 'Component'
          : node.repeat
            ? 'Repeater'
            : 'Frame'
  return (
    <div className="insp-name-row">
      <span className={`node-kind-badge kind-${kind.toLowerCase()}`}>{kind}</span>
      <TextField value={node.name} onChange={(v) => renameNode(node.id, v)} />
    </div>
  )
}

function LayoutSection({ node }: { node: AnyNode }) {
  const doc = useStore((s) => s.doc)
  const patchNode = useStore((s) => s.patchNode)
  const setSizeMode = useStore((s) => s.setSizeMode)
  const auto = isAutoChild(doc, node.id)
  const fillAllowed = auto

  const modeOptions = (allowFill: boolean): { value: SizeMode; label: string }[] => [
    { value: 'fixed', label: 'Fixed' },
    { value: 'hug', label: 'Hug' },
    ...(allowFill ? [{ value: 'fill' as SizeMode, label: 'Fill' }] : []),
  ]

  return (
    <Section title="Layout">
      {!auto && (
        <Row label="Position">
          <NumberField value={Math.round(node.x)} onChange={(x) => patchNode(node.id, { x })} title="X" />
          <NumberField value={Math.round(node.y)} onChange={(y) => patchNode(node.id, { y })} title="Y" />
        </Row>
      )}
      <Row label="Width">
        <NumberField
          value={Math.round(node.width)}
          disabled={node.widthMode !== 'fixed'}
          min={1}
          onChange={(width) => patchNode(node.id, { width })}
        />
        <SelectField
          value={node.widthMode}
          options={modeOptions(fillAllowed)}
          onChange={(m) => setSizeMode(node.id, 'width', m)}
        />
      </Row>
      <Row label="Height">
        <NumberField
          value={Math.round(node.height)}
          disabled={node.heightMode !== 'fixed'}
          min={1}
          onChange={(height) => patchNode(node.id, { height })}
        />
        <SelectField
          value={node.heightMode}
          options={modeOptions(fillAllowed)}
          onChange={(m) => setSizeMode(node.id, 'height', m)}
        />
      </Row>
    </Section>
  )
}

/** Measure children in world units so removing auto layout keeps positions. */
function measureChildWorldRects(parentId: NodeId, zoom: number) {
  const parentEl = document.querySelector(`[data-node-id="${CSS.escape(parentId)}"]`)
  if (!parentEl) return undefined
  const prect = parentEl.getBoundingClientRect()
  const out: Record<NodeId, { x: number; y: number; width: number; height: number }> = {}
  for (const el of parentEl.children) {
    const id = (el as HTMLElement).dataset?.nodeId
    if (!id) continue
    const r = el.getBoundingClientRect()
    out[id] = {
      x: Math.round((r.left - prect.left) / zoom),
      y: Math.round((r.top - prect.top) / zoom),
      width: Math.round(r.width / zoom),
      height: Math.round(r.height / zoom),
    }
  }
  return out
}

function AutoLayoutSection({ node }: { node: FrameNode }) {
  const setAutoLayout = useStore((s) => s.setAutoLayout)
  const patchAutoLayout = useStore((s) => s.patchAutoLayout)
  const zoom = useStore((s) => s.viewport.zoom)
  const al = node.autoLayout

  return (
    <Section
      title="Auto layout"
      badge={
        <button
          className="mini-btn"
          title={al ? 'Remove auto layout (Shift+A)' : 'Add auto layout (Shift+A)'}
          onClick={() => {
            if (al) setAutoLayout(node.id, null, measureChildWorldRects(node.id, zoom))
            else setAutoLayout(node.id, { ...DEFAULT_AUTO_LAYOUT })
          }}
        >
          {al ? <X size={12} /> : <Plus size={12} />}
        </button>
      }
    >
      {al ? (
        <>
          <Row label="Direction">
            <Segmented
              value={al.direction}
              options={[
                { value: 'column', label: <ArrowDown size={13} />, title: 'Vertical' },
                { value: 'row', label: <ArrowRight size={13} />, title: 'Horizontal' },
              ]}
              onChange={(direction) => patchAutoLayout(node.id, { direction })}
            />
            <Checkbox checked={al.wrap} onChange={(wrap) => patchAutoLayout(node.id, { wrap })} label="Wrap" />
          </Row>
          <Row label="Gap">
            <NumberField value={al.gap} min={0} onChange={(gap) => patchAutoLayout(node.id, { gap })} />
          </Row>
          <Row label="Padding">
            <NumberField value={al.paddingX} min={0} onChange={(paddingX) => patchAutoLayout(node.id, { paddingX })} title="Horizontal" />
            <NumberField value={al.paddingY} min={0} onChange={(paddingY) => patchAutoLayout(node.id, { paddingY })} title="Vertical" />
          </Row>
          <Row label="Align">
            <SelectField
              value={al.align}
              options={[
                { value: 'start', label: 'Start' },
                { value: 'center', label: 'Center' },
                { value: 'end', label: 'End' },
              ]}
              onChange={(align) => patchAutoLayout(node.id, { align })}
            />
            <SelectField
              value={al.justify}
              options={[
                { value: 'start', label: 'Pack start' },
                { value: 'center', label: 'Pack center' },
                { value: 'end', label: 'Pack end' },
                { value: 'between', label: 'Space between' },
              ]}
              onChange={(justify) => patchAutoLayout(node.id, { justify })}
            />
          </Row>
        </>
      ) : (
        <div className="insp-hint">Children are freely positioned. Add auto layout to stack them.</div>
      )}
    </Section>
  )
}

function FrameStyleSection({ node }: { node: FrameNode }) {
  const patchNode = useStore((s) => s.patchNode)
  return (
    <Section title="Style">
      <Row label="Fill">
        <ColorField value={node.fill} allowNone onChange={(fill) => patchNode(node.id, { fill })} />
      </Row>
      <Row label="Stroke">
        <ColorField value={node.stroke} allowNone onChange={(stroke) => patchNode(node.id, { stroke })} />
        {node.stroke && (
          <NumberField value={node.strokeWidth} min={0.5} step={0.5} onChange={(strokeWidth) => patchNode(node.id, { strokeWidth })} />
        )}
      </Row>
      <Row label="Radius">
        <NumberField value={node.cornerRadius} min={0} onChange={(cornerRadius) => patchNode(node.id, { cornerRadius })} />
      </Row>
      <Row>
        <Checkbox checked={node.shadow} onChange={(shadow) => patchNode(node.id, { shadow })} label="Shadow" />
        <Checkbox checked={node.clip} onChange={(clip) => patchNode(node.id, { clip })} label="Clip content" />
      </Row>
    </Section>
  )
}

function TextStyleSection({ node }: { node: TextNode }) {
  const patchTextStyle = useStore((s) => s.patchTextStyle)
  const s = node.style
  return (
    <Section title="Text">
      <Row label="Font">
        <SelectField
          value={s.fontFamily}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
          onChange={(fontFamily) => patchTextStyle(node.id, { fontFamily })}
        />
        <SelectField
          value={String(s.fontWeight) as '400'}
          options={[
            { value: '400', label: 'Regular' },
            { value: '500', label: 'Medium' },
            { value: '600', label: 'Semibold' },
            { value: '700', label: 'Bold' },
            { value: '800', label: 'Extrabold' },
          ]}
          onChange={(w) => patchTextStyle(node.id, { fontWeight: parseInt(w, 10) as 400 })}
        />
      </Row>
      <Row label="Size">
        <NumberField value={s.fontSize} min={6} max={200} onChange={(fontSize) => patchTextStyle(node.id, { fontSize })} />
        <NumberField
          value={s.lineHeight}
          min={0.8}
          max={3}
          step={0.1}
          title="Line height"
          onChange={(lineHeight) => patchTextStyle(node.id, { lineHeight })}
        />
      </Row>
      <Row label="Spacing">
        <NumberField
          value={s.letterSpacing}
          min={-2}
          max={20}
          step={0.1}
          title="Letter spacing (px)"
          onChange={(letterSpacing) => patchTextStyle(node.id, { letterSpacing })}
        />
        <Checkbox checked={s.uppercase} onChange={(uppercase) => patchTextStyle(node.id, { uppercase })} label="Caps" />
      </Row>
      <Row label="Color">
        <ColorField value={s.color} onChange={(color) => color && patchTextStyle(node.id, { color })} />
      </Row>
      <Row label="Align">
        <Segmented
          value={s.textAlign}
          options={[
            { value: 'left', label: <AlignLeft size={13} /> },
            { value: 'center', label: <AlignCenter size={13} /> },
            { value: 'right', label: <AlignRight size={13} /> },
          ]}
          onChange={(textAlign) => patchTextStyle(node.id, { textAlign })}
        />
      </Row>
    </Section>
  )
}

function ContentSection({ node }: { node: TextNode }) {
  const doc = useStore((s) => s.doc)
  const setContent = useStore((s) => s.setContent)
  const exposeAsProp = useStore((s) => s.exposeAsProp)
  const collectionPath = enclosingCollectionPath(doc, node.id)
  const component = enclosingComponent(doc, node.id)
  const [propName, setPropName] = useState('')

  return (
    <Section title="Content" badge={<SourceBadge source={node.content} />}>
      <ContentSourceEditor
        source={node.content}
        onChange={(src) => setContent(node.id, src)}
        collectionPath={collectionPath}
        propNames={component ? (component.props ?? []).map((p) => p.name) : undefined}
      />
      {component && node.content.type !== 'prop' && (
        <div className="expose-row">
          <TextField value={propName} placeholder="new prop name…" onChange={setPropName} />
          <button
            className="btn btn-component"
            title="Create a component prop from this text and bind to it"
            onClick={() => {
              exposeAsProp(node.id, propName)
              setPropName('')
            }}
          >
            <Component size={12} /> Expose
          </button>
        </div>
      )}
      {collectionPath && (
        <div className="insp-hint">
          Inside a repeater bound to <code>{collectionPath}</code> — bind to <code>item.*</code> paths for per-item content.
        </div>
      )}
    </Section>
  )
}

function SourceBadge({ source }: { source: ContentSource }) {
  const map = {
    static: null,
    binding: { label: 'data', cls: 'chip-binding' },
    generator: { label: 'generator', cls: 'chip-generator' },
    prop: { label: 'prop', cls: 'chip-prop' },
  } as const
  const m = map[source.type]
  if (!m) return null
  return <span className={`content-chip ${m.cls}`}>{m.label}</span>
}

function MakeComponentSection({ node }: { node: FrameNode }) {
  const makeComponent = useStore((s) => s.makeComponent)
  return (
    <Section title="Component">
      <button className="btn btn-component" onClick={() => makeComponent(node.id)}>
        <Component size={13} /> Create component
      </button>
      <div className="insp-hint">Turn this frame into a reusable component with overridable props.</div>
    </Section>
  )
}

function ComponentSection({ node }: { node: FrameNode }) {
  const addPropToComponent = useStore((s) => s.addPropToComponent)
  const removePropFromComponent = useStore((s) => s.removePropFromComponent)
  const patchNode = useStore((s) => s.patchNode)
  const insertInstance = useStore((s) => s.insertInstance)
  const [name, setName] = useState('')
  const [def, setDef] = useState('')
  const props = node.props ?? []

  return (
    <Section title="Component props" badge={<span className="content-chip chip-prop">❖ component</span>}>
      {props.length === 0 && (
        <div className="insp-hint">
          No props yet. Add one here, or select a text layer inside and “Expose” it.
        </div>
      )}
      {props.map((p) => (
        <div className="prop-row" key={p.name}>
          <span className="prop-name" title="Prop name">{p.name}</span>
          <TextField
            value={p.defaultValue}
            onChange={(v) =>
              patchNode(node.id, {
                props: props.map((q) => (q.name === p.name ? { ...q, defaultValue: v } : q)),
              })
            }
          />
          <button className="mini-btn" title="Remove prop" onClick={() => removePropFromComponent(node.id, p.name)}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className="prop-row">
        <TextField value={name} placeholder="name" onChange={setName} />
        <TextField value={def} placeholder="default value" onChange={setDef} />
        <button
          className="mini-btn"
          title="Add prop"
          onClick={() => {
            if (name.trim()) {
              addPropToComponent(node.id, name, def)
              setName('')
              setDef('')
            }
          }}
        >
          <Plus size={12} />
        </button>
      </div>
      <button
        className="btn btn-component"
        onClick={() => {
          const v = useStore.getState().viewport
          const el = document.querySelector('.canvas-container')
          const r = el?.getBoundingClientRect()
          const cx = r ? (r.width / 2 - v.x) / v.zoom : node.x + node.width + 60
          const cy = r ? (r.height / 2 - v.y) / v.zoom : node.y
          insertInstance(node.id, Math.round(cx), Math.round(cy))
        }}
      >
        <Plus size={13} /> Insert instance
      </button>
    </Section>
  )
}

function InstanceSection({ node }: { node: InstanceNode }) {
  const doc = useStore((s) => s.doc)
  const select = useStore((s) => s.select)
  const setInstanceOverride = useStore((s) => s.setInstanceOverride)
  const detachInstance = useStore((s) => s.detachInstance)
  const def = doc.nodes[node.componentId]
  if (!def || def.type !== 'frame') {
    return (
      <Section title="Instance">
        <div className="insp-hint">The component definition for this instance was deleted.</div>
      </Section>
    )
  }
  const collectionPath = enclosingCollectionPath(doc, node.id)
  const props = def.props ?? []

  return (
    <Section title={`Instance of “${def.name}”`} badge={<span className="content-chip chip-prop">◇ instance</span>}>
      {props.length === 0 && <div className="insp-hint">This component has no props to override.</div>}
      {props.map((p) => {
        const override = node.overrides[p.name]
        return (
          <div className="instance-prop" key={p.name}>
            <div className="instance-prop-head">
              <span className="prop-name">{p.name}</span>
              {override ? (
                <button className="mini-btn" title="Reset to component default" onClick={() => setInstanceOverride(node.id, p.name, null)}>
                  <X size={11} />
                </button>
              ) : (
                <span className="insp-hint-inline">default</span>
              )}
            </div>
            <ContentSourceEditor
              compact
              source={override ?? { type: 'static', value: p.defaultValue }}
              onChange={(src) => setInstanceOverride(node.id, p.name, src)}
              collectionPath={collectionPath}
            />
          </div>
        )
      })}
      {collectionPath && (
        <div className="insp-hint">
          Inside a repeater bound to <code>{collectionPath}</code> — bind props to <code>item.*</code> paths.
        </div>
      )}
      <Row>
        <button className="btn" onClick={() => select([def.id])}>Go to main</button>
        <button className="btn" onClick={() => detachInstance(node.id)}>Detach</button>
      </Row>
    </Section>
  )
}

function RepeaterSection({ node }: { node: FrameNode }) {
  const doc = useStore((s) => s.doc)
  const setRepeat = useStore((s) => s.setRepeat)
  const collections = listCollectionPaths(doc.data)
  const rep = node.repeat ?? null
  const mode = rep?.mode ?? 'off'
  const itemCount =
    rep?.mode === 'collection'
      ? (() => {
          const v = getByPath(doc.data, rep.path)
          return Array.isArray(v) ? v.length : 0
        })()
      : rep?.mode === 'count'
        ? rep.count
        : 0

  return (
    <Section
      title="Repeater"
      badge={rep ? <span className="content-chip chip-repeater">⟳ {itemCount} items</span> : undefined}
    >
      <Segmented
        value={mode}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'count', label: 'Count', title: 'Repeat the first child a fixed number of times' },
          { value: 'collection', label: 'Data', title: 'Repeat the first child once per item of a collection' },
        ]}
        onChange={(m) => {
          if (m === 'off') setRepeat(node.id, null)
          else if (m === 'count') setRepeat(node.id, { mode: 'count', count: 4 })
          else setRepeat(node.id, { mode: 'collection', path: collections[0]?.path ?? '' })
        }}
      />
      {rep?.mode === 'count' && (
        <Row label="Count">
          <NumberField
            value={rep.count}
            min={0}
            max={100}
            onChange={(count) => setRepeat(node.id, { mode: 'count', count })}
          />
        </Row>
      )}
      {rep?.mode === 'collection' && (
        <Row label="Collection">
          <SelectField
            value={rep.path}
            options={[
              ...(collections.some((c) => c.path === rep.path)
                ? []
                : [{ value: rep.path, label: rep.path || '— choose —' }]),
              ...collections.map((c) => ({ value: c.path, label: `${c.path} (${c.length} items)` })),
            ]}
            onChange={(path) => setRepeat(node.id, { mode: 'collection', path })}
          />
        </Row>
      )}
      {rep ? (
        <div className="insp-hint">
          The <b>first child</b> is the repeated template
          {node.children.length > 1
            ? '; the second child is the empty state, shown when there are 0 items.'
            : '. Add a second child to design the empty state.'}
          {rep.mode === 'collection' && ' Bind text inside the template to item.* paths.'}
        </div>
      ) : (
        <div className="insp-hint">Repeat this frame’s first child from a count or a data collection.</div>
      )}
    </Section>
  )
}
