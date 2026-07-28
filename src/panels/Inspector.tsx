import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  Component,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react'
import { GENERATOR_UNITS } from '../model/generators'
import { componentFields, listCollectionPaths, getByPath, resolveText } from '../model/resolve'
import { FIELD_INTENTS, fieldOwner, intentLabel } from '../model/schema'
import {
  DEFAULT_AUTO_LAYOUT,
  DEFAULT_FIELD_NAME_RE,
  type AnyNode,
  type DesignDoc,
  type FieldConnection,
  type FrameNode,
  type InstanceNode,
  type NodeId,
  type SizeMode,
  type TextNode,
} from '../model/types'
import { isAutoChild, useStore } from '../store'
import { ConnectionEditor, previewContext } from '../ui/ConnectionEditor'
import {
  Checkbox,
  ColorField,
  NumberField,
  Row,
  Section,
  Segmented,
  SelectField,
  TextArea,
  TextField,
} from '../ui/controls'

export function Inspector() {
  const tool = useStore((s) => s.tool)
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => s.doc.nodes)

  if (tool === 'frame') return <FramePresetsSection />
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
      {node.type === 'text' && <ContentFieldSection node={node} />}
      {node.type === 'frame' && !node.isComponent && !node.repeat && <MakeComponentSection node={node} />}
      {node.type === 'frame' && node.isComponent && <ComponentSection node={node} />}
      {node.type === 'instance' && <InstanceSection node={node} />}
      {node.type === 'frame' && !node.isComponent && <RepeaterSection node={node} />}
      {node.type !== 'frame' && <RepeatThisSection node={node} />}
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
          <li>Mark a text layer as a <b>content field</b> — or just connect it to data or a generator, which marks it for you</li>
          <li>Turn a frame into a <b>component</b>: the fields inside it are its content API</li>
          <li><b>Repeat this</b> wraps any layer in a repeater; bind the repeater to a collection</li>
        </ul>
      </div>
    </div>
  )
}

const FRAME_PRESETS: { name: string; w: number; h: number }[] = [
  { name: 'Desktop', w: 1200, h: 960 },
  { name: 'Web', w: 1440, h: 1024 },
  { name: 'Tablet', w: 834, h: 1194 },
  { name: 'Phone', w: 390, h: 844 },
  { name: 'Card', w: 360, h: 240 },
  { name: 'Square', w: 480, h: 480 },
]

function FramePresetsSection() {
  const addFrameAt = useStore((s) => s.addFrameAt)

  const insertPreset = (name: string, w: number, h: number) => {
    const v = useStore.getState().viewport
    const el = document.querySelector('.canvas-container')
    const r = el?.getBoundingClientRect()
    const cx = r ? (r.width / 2 - v.x) / v.zoom : w / 2
    const cy = r ? (r.height / 2 - v.y) / v.zoom : h / 2
    addFrameAt(null, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, name)
  }

  return (
    <div className="inspector">
      <Section title="Frame presets">
        {FRAME_PRESETS.map((p) => (
          <button key={p.name} className="preset-row" onClick={() => insertPreset(p.name, p.w, p.h)}>
            <span>{p.name}</span>
            <span className="preset-dims">{p.w} × {p.h}</span>
          </button>
        ))}
        <div className="insp-hint">…or drag on the canvas to draw a frame at any size.</div>
      </Section>
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
      {node.type === 'frame' && !node.isComponent && (
        <Row>
          <RepeatThisButton node={node} />
        </Row>
      )}
    </Section>
  )
}

/** Structure-first repeater: wrap the selected layer instead of designating a wrapper. */
function RepeatThisButton({ node }: { node: AnyNode }) {
  const repeatNode = useStore((s) => s.repeatNode)
  return (
    <button
      className="btn btn-repeater"
      title="Wrap this layer in a new repeater frame, starting at 3 clones"
      onClick={() => repeatNode(node.id)}
    >
      <Repeat size={13} /> Repeat this
    </button>
  )
}

/** Text and instances have no repeater section of their own — this is their door. */
function RepeatThisSection({ node }: { node: TextNode | InstanceNode }) {
  return (
    <Section title="Repeater">
      <RepeatThisButton node={node} />
      <div className="insp-hint">Wraps this layer in a repeater frame that clones it 3 times to start.</div>
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

const CONNECTION_LABEL: Record<FieldConnection['type'], string> = {
  none: 'placeholder',
  generator: 'generator',
  binding: 'data',
}

const CONNECTION_CHIP: Record<FieldConnection['type'], string> = {
  none: 'chip-placeholder',
  generator: 'chip-generator',
  binding: 'chip-binding',
}

function ConnectionChip({ connection }: { connection: FieldConnection }) {
  return (
    <span className={`content-chip ${CONNECTION_CHIP[connection.type]}`}>
      {CONNECTION_LABEL[connection.type]}
    </span>
  )
}

/** Where a node's fields belong: a bound repeater template, or a component definition. */
function fieldScope(doc: DesignDoc, id: NodeId): { collectionPath?: string; componentName?: string } {
  const owner = fieldOwner(doc, id)
  if (!owner) return {}
  const frame = doc.nodes[owner.id]
  if (frame?.type !== 'frame') return {}
  if (owner.kind === 'component') return { componentName: frame.name }
  return frame.repeat?.mode === 'collection' ? { collectionPath: frame.repeat.path } : {}
}

/**
 * Designation first: a text layer is plain until it is marked as a field, and
 * only then does its name, intent and constraint mean anything. The connection
 * sits inside the field block because it is the field climbing its ladder —
 * except on plain text, where connecting marks the layer in the same action.
 */
function ContentFieldSection({ node }: { node: TextNode }) {
  const doc = useStore((s) => s.doc)
  const markAsField = useStore((s) => s.markAsField)
  const updateField = useStore((s) => s.updateField)
  const field = node.field
  const { collectionPath, componentName } = fieldScope(doc, node.id)

  return (
    <Section
      title="Content field"
      badge={
        field ? (
          <ConnectionChip connection={field.connection} />
        ) : (
          <span className="insp-hint-inline">plain text</span>
        )
      }
    >
      {!field && (
        <button className="btn btn-mark-field" onClick={() => markAsField(node.id)}>
          ＋ Mark as content field
        </button>
      )}

      {field && (
        <div className="content-field-set">
          <Row label="Name">
            <TextField value={field.name} onChange={(name) => updateField(node.id, { name })} />
          </Row>
          <Row label="Intent">
            <SelectField
              value={field.intent}
              options={FIELD_INTENTS}
              onChange={(intent) => updateField(node.id, { intent })}
            />
          </Row>
          <Row label="Description">
            <TextArea
              value={field.description ?? ''}
              rows={2}
              placeholder="Notes for developers & editors"
              onChange={(description) => updateField(node.id, { description })}
            />
          </Row>
          <Row label="Max length">
            <NumberField
              value={field.maxLength?.count ?? 1}
              min={1}
              disabled={!field.maxLength}
              onChange={(count) =>
                updateField(node.id, { maxLength: { unit: field.maxLength?.unit ?? 'words', count } })
              }
            />
            <SelectField
              value={field.maxLength?.unit ?? 'words'}
              disabled={!field.maxLength}
              options={GENERATOR_UNITS}
              onChange={(unit) =>
                updateField(node.id, { maxLength: { unit, count: field.maxLength?.count ?? 20 } })
              }
            />
            <button
              className="mini-btn"
              title={field.maxLength ? 'Clear max length' : 'Set a max length'}
              onClick={() =>
                updateField(node.id, { maxLength: field.maxLength ? null : { unit: 'words', count: 20 } })
              }
            >
              {field.maxLength ? <X size={12} /> : <Plus size={12} />}
            </button>
          </Row>
          {DEFAULT_FIELD_NAME_RE.test(field.name) && (
            <div className="insp-hint">
              {collectionPath
                ? 'Default name — rename it to a key of the bound data and it connects itself.'
                : 'Default name — rename it to say what this content is.'}
            </div>
          )}
        </div>
      )}

      <div className="insp-subhead">Connection</div>
      <ConnectionEditor target={{ kind: 'node', node }} collectionPath={collectionPath} />

      {collectionPath && (
        <div className="insp-hint">
          Inside a repeater bound to <code>{collectionPath}</code> — bind to <code>item.*</code> paths for per-item content.
        </div>
      )}
      {componentName && (
        <div className="insp-hint">
          Inside component “{componentName}” — this field is part of its content API; instances override it by name.
        </div>
      )}
    </Section>
  )
}

function MakeComponentSection({ node }: { node: FrameNode }) {
  const makeComponent = useStore((s) => s.makeComponent)
  return (
    <Section title="Component">
      <button className="btn btn-component" onClick={() => makeComponent(node.id)}>
        <Component size={13} /> Create component
      </button>
      <div className="insp-hint">Turn this frame into a reusable component; the fields inside it become its API.</div>
    </Section>
  )
}

function ComponentSection({ node }: { node: FrameNode }) {
  const doc = useStore((s) => s.doc)
  const select = useStore((s) => s.select)
  const insertInstance = useStore((s) => s.insertInstance)
  const fields = componentFields(doc, node.id)

  return (
    <Section title="Component" badge={<span className="content-chip chip-component">❖ component</span>}>
      <div className="insp-subhead">Fields</div>
      {fields.length === 0 ? (
        <div className="insp-hint">
          No fields yet. Select a text layer inside and mark it as a content field.
        </div>
      ) : (
        fields.map(({ node: text, field }) => (
          <button
            key={field.name}
            className="field-row"
            title="Select the text layer that declares this field"
            onClick={() => select([text.id])}
          >
            <span className="field-row-name">{field.name}</span>
            <span className="field-row-intent">{intentLabel(field.intent)}</span>
            <ConnectionChip connection={field.connection} />
          </button>
        ))
      )}
      <div className="insp-hint">Fields inside this component are its content API.</div>
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
  const { collectionPath } = fieldScope(doc, node.id)
  const ctx = previewContext(doc, collectionPath)
  const fields = componentFields(doc, node.componentId)

  return (
    <Section title={`Instance of “${def.name}”`} badge={<span className="content-chip chip-component">◇ instance</span>}>
      {fields.length === 0 && (
        <div className="insp-hint">
          This component has no fields yet — mark a text layer inside the definition to give it one.
        </div>
      )}
      {fields.map(({ node: defNode, field }) => {
        const override = node.overrides[field.name]
        const defaultText = resolveText(defNode, doc, ctx).text
        return (
          <div className="instance-field" key={field.name}>
            <div className="instance-field-head">
              <span className="field-row-name">{field.name}</span>
              {!override && (
                <button
                  className="link-btn"
                  title="Give this instance its own value for this field"
                  onClick={() =>
                    setInstanceOverride(node.id, field.name, { type: 'static', value: defaultText })
                  }
                >
                  Override
                </button>
              )}
            </div>
            {override ? (
              <ConnectionEditor
                compact
                collectionPath={collectionPath}
                target={{
                  kind: 'override',
                  instanceId: node.id,
                  fieldName: field.name,
                  value: override,
                  intent: field.intent,
                }}
              />
            ) : (
              <div className="instance-field-default" title="Value from the component definition">
                {defaultText || '(empty)'}
              </div>
            )}
          </div>
        )
      })}
      {collectionPath && (
        <div className="insp-hint">
          Inside a repeater bound to <code>{collectionPath}</code> — override fields with <code>item.*</code> paths.
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
  const makeRepeater = useStore((s) => s.makeRepeater)
  const addEmptyState = useStore((s) => s.addEmptyState)
  const collections = listCollectionPaths(doc.data)
  const rep = node.repeat ?? null

  if (!rep) {
    return (
      <Section title="Repeater">
        <button
          className="btn btn-repeater"
          disabled={node.children.length === 0}
          title="Repeat this frame’s first child"
          onClick={() => makeRepeater(node.id)}
        >
          <Repeat size={13} /> Make repeater
        </button>
        <div className="insp-hint">
          {node.children.length === 0
            ? 'A repeater clones its first child — give this frame a child first.'
            : 'Clones this frame’s first child, 3 times to start; connect it to a collection when you have one.'}
        </div>
      </Section>
    )
  }

  const itemCount =
    rep.mode === 'collection'
      ? (() => {
          const v = getByPath(doc.data, rep.path)
          return Array.isArray(v) ? v.length : 0
        })()
      : rep.count

  return (
    <Section title="Repeater" badge={<span className="content-chip chip-repeater">⟳ {itemCount} items</span>}>
      <Segmented
        value={rep.mode}
        options={[
          { value: 'count', label: 'Count', title: 'A fixed number of clones — the repeater’s placeholder state' },
          { value: 'collection', label: 'Data', title: 'One clone per item of a data collection' },
        ]}
        onChange={(mode) => {
          if (mode === 'count') setRepeat(node.id, { mode: 'count', count: 3 })
          else setRepeat(node.id, { mode: 'collection', path: collections[0]?.path ?? '' })
        }}
      />
      {rep.mode === 'count' && (
        <Row label="Count">
          <NumberField
            value={rep.count}
            min={0}
            max={100}
            onChange={(count) => setRepeat(node.id, { mode: 'count', count })}
          />
        </Row>
      )}
      {rep.mode === 'collection' && (
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
      {node.children.length === 1 && (
        <button
          className="btn"
          title="Add a second child, shown when the collection is empty"
          onClick={() => addEmptyState(node.id)}
        >
          <Plus size={13} /> Add empty state
        </button>
      )}
      <div className="insp-hint">
        The <b>first child</b> is the repeated template
        {node.children.length > 1
          ? '; the second is the empty state, shown when there are 0 items.'
          : '.'}
        {rep.mode === 'collection' && ' Bind fields inside the template to item.* paths.'}
      </div>
      <button
        className="btn btn-detach"
        title="Demote back to an ordinary frame, keeping its children"
        onClick={() => setRepeat(node.id, null)}
      >
        Remove repeater
      </button>
    </Section>
  )
}
