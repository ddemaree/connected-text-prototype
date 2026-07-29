export type NodeId = string

/** How a node sizes itself along one axis. */
export type SizeMode = 'fixed' | 'hug' | 'fill'

export interface AutoLayout {
  direction: 'row' | 'column'
  gap: number
  paddingX: number
  paddingY: number
  /** Cross-axis alignment of children. */
  align: 'start' | 'center' | 'end'
  /** Main-axis distribution. */
  justify: 'start' | 'center' | 'end' | 'between'
  wrap: boolean
}

export type GeneratorKind = 'title' | 'standfirst' | 'paragraph' | 'label' | 'name'
export type GeneratorUnit = 'words' | 'sentences' | 'characters'

export interface GeneratorConfig {
  kind: GeneratorKind
  unit: GeneratorUnit
  count: number
  /** Seed for deterministic output; reroll to get different text. */
  seed: number
}

/** What a piece of content IS, independent of where it comes from. */
export type FieldIntent = GeneratorKind | 'custom'

/**
 * The one connection ladder a field climbs: placeholder → generator → bound.
 * Each state subsumes the value of the one before it.
 */
export type FieldConnection =
  | { type: 'none' }
  | { type: 'generator'; config: GeneratorConfig }
  | { type: 'binding'; path: string }

/**
 * The designation that turns plain text into structured content. A field is the
 * unit of the published contract: only fields appear in the schema, and only
 * fields can be connected to data or generators.
 */
export interface TextField {
  /** Schema field name; may still be a default 'text_field_N'. */
  name: string
  /** What this content IS — reuses generator kinds as the intent vocabulary. */
  intent: FieldIntent
  /** Author note for developers/editors. */
  description?: string
  /** Editorial constraint; unit reuses GeneratorUnit. */
  maxLength?: { unit: GeneratorUnit; count: number } | null
  connection: FieldConnection
}

/** Default field names are the "Frame 12" of this system: valid, but unmapped. */
export const DEFAULT_FIELD_NAME_RE = /^text_field_\d+$/

export interface TextStyle {
  fontFamily: 'sans' | 'serif' | 'mono'
  fontSize: number
  fontWeight: 400 | 500 | 600 | 700 | 800
  /** Multiplier, e.g. 1.4 */
  lineHeight: number
  letterSpacing: number
  color: string
  textAlign: 'left' | 'center' | 'right'
  uppercase: boolean
}

export type RepeatConfig =
  | { mode: 'count'; count: number }
  | { mode: 'collection'; path: string }

interface BaseNode {
  id: NodeId
  name: string
  parentId: NodeId | null
  /** Position, used when the parent does not use auto layout (or node is top-level). */
  x: number
  y: number
  /** Used when the corresponding axis mode is 'fixed'. */
  width: number
  height: number
  widthMode: SizeMode
  heightMode: SizeMode
}

export interface FrameNode extends BaseNode {
  type: 'frame'
  children: NodeId[]
  fill: string | null
  stroke: string | null
  strokeWidth: number
  cornerRadius: number
  shadow: boolean
  clip: boolean
  autoLayout: AutoLayout | null
  /** When true this frame is a reusable component definition; its fields are its API. */
  isComponent?: boolean
  /**
   * Repeater: when set, the frame renders its first child N times
   * (fixed count, or once per item of a bound collection). A second
   * child, if present, acts as the empty state when there are 0 items.
   */
  repeat?: RepeatConfig | null
}

export interface TextNode extends BaseNode {
  type: 'text'
  style: TextStyle
  /** Literal text: the content of plain text, the placeholder/default of a field. */
  text: string
  field?: TextField | null
}

/** A per-instance value for one of a component's fields. */
export type OverrideValue =
  | { type: 'static'; value: string }
  | { type: 'generator'; config: GeneratorConfig }
  | { type: 'binding'; path: string }

export interface InstanceNode extends BaseNode {
  type: 'instance'
  componentId: NodeId
  /** Keyed by FIELD NAME of the definition's fields. Missing key = definition default. */
  overrides: Record<string, OverrideValue>
}

export type AnyNode = FrameNode | TextNode | InstanceNode

export interface DesignDoc {
  nodes: Record<NodeId, AnyNode>
  rootIds: NodeId[]
  /** The JSON data source that bindings resolve against. */
  data: unknown
}

/** Context threaded through rendering/resolution. */
export interface RenderContext {
  /** Current collection item inside a collection-bound repeater. */
  item?: unknown
  /** Clone index inside a repeater (0-based). */
  index?: number
  /** Resolved per-instance override values, keyed by field name. */
  fieldValues?: Record<string, string>
  /** Extra offset mixed into generator seeds so clones/instances vary. */
  seedOffset?: number
}

let counter = 0
export function newId(prefix = 'n'): NodeId {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'sans',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,
  color: '#1a1a1a',
  textAlign: 'left',
  uppercase: false,
}

export const DEFAULT_AUTO_LAYOUT: AutoLayout = {
  direction: 'column',
  gap: 12,
  paddingX: 16,
  paddingY: 16,
  align: 'start',
  justify: 'start',
  wrap: false,
}
