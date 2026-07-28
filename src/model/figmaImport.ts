import {
  finishImport,
  isRepeatCandidate,
  sanitize,
  type ImportResult,
  type IrFrame,
  type IrNode,
  type IrText,
} from './importIr'
import { DEFAULT_TEXT_STYLE, type AutoLayout, type SizeMode, type TextStyle } from './types'

/**
 * Importer for Figma clipboard data.
 *
 * When layers are copied in Figma (or produced by Figma's web-capture Chrome
 * extension), the clipboard's text/html contains the whole scene fragment as a
 * base64 blob inside an HTML comment:
 *
 *   <span data-buffer="<!--(figma)BASE64(/figma)-->"></span>
 *
 * The blob is a "fig-kiwi" archive: an 8-byte prelude + uint32 version,
 * followed by length-prefixed chunks of raw-DEFLATE data. Chunk 0 is a binary
 * Kiwi schema (https://github.com/evanw/kiwi), chunk 1 is a Kiwi `Message`
 * encoded with that schema, whose `nodeChanges` array holds one record per
 * copied layer. Because the schema ships alongside the data, decoding needs no
 * knowledge of Figma's current schema version.
 */

const FIG_START = '<!--(figma)'
const FIG_END = '(/figma)-->'

export function isFigmaClipboard(html: string): boolean {
  const start = html.indexOf(FIG_START)
  return start >= 0 && html.indexOf(FIG_END, start) > start
}

function extractFigBytes(html: string): Uint8Array | null {
  const start = html.indexOf(FIG_START)
  if (start < 0) return null
  const end = html.indexOf(FIG_END, start)
  if (end < 0) return null
  const b64 = html.slice(start + FIG_START.length, end).replace(/\s+/g, '')
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

// ---- fig-kiwi archive ----

function parseArchive(bytes: Uint8Array): Uint8Array[] {
  const prelude = String.fromCharCode(...bytes.subarray(0, 8))
  if (prelude !== 'fig-kiwi') throw new Error('not a fig-kiwi archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12 // prelude + uint32 version
  const chunks: Uint8Array[] = []
  while (offset + 4 <= bytes.length) {
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.length) throw new Error('truncated fig-kiwi chunk')
    chunks.push(bytes.subarray(offset, offset + size))
    offset += size
  }
  return chunks
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const attempt = async (format: 'deflate-raw' | 'deflate') => {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  try {
    return await attempt('deflate-raw')
  } catch {
    return await attempt('deflate')
  }
}

// ---- generic Kiwi decoding ----
// A small interpreter for Kiwi's binary schema + message encoding, ported from
// the reference implementation (github.com/evanw/kiwi).

class Reader {
  private i = 0
  constructor(private data: Uint8Array) {}

  byte(): number {
    if (this.i >= this.data.length) throw new Error('kiwi: out of bounds')
    return this.data[this.i++]
  }

  byteArray(): Uint8Array {
    const length = this.varUint()
    if (this.i + length > this.data.length) throw new Error('kiwi: out of bounds')
    const out = this.data.slice(this.i, this.i + length)
    this.i += length
    return out
  }

  varUint(): number {
    let value = 0
    let shift = 0
    let b: number
    do {
      b = this.byte()
      value |= (b & 127) << shift
      shift += 7
    } while (b & 128 && shift < 35)
    return value >>> 0
  }

  varInt(): number {
    const value = this.varUint() | 0
    return value & 1 ? ~(value >>> 1) : value >>> 1
  }

  varUint64(): bigint {
    let value = 0n
    let shift = 0n
    let b: number
    while ((b = this.byte()) & 128 && shift < 56n) {
      value |= BigInt(b & 127) << shift
      shift += 7n
    }
    return value | (BigInt(b) << shift)
  }

  varInt64(): bigint {
    const value = this.varUint64()
    return value & 1n ? ~(value >> 1n) : value >> 1n
  }

  varFloat(): number {
    const first = this.byte()
    if (first === 0) return 0
    if (this.i + 3 > this.data.length) throw new Error('kiwi: out of bounds')
    const d = this.data
    let bits = first | (d[this.i] << 8) | (d[this.i + 1] << 16) | (d[this.i + 2] << 24)
    this.i += 3
    // The exponent is stored in the low byte so common values stay short.
    bits = (bits << 23) | (bits >>> 9)
    scratchInt[0] = bits
    return scratchFloat[0]
  }

  string(): string {
    const start = this.i
    while (this.byte() !== 0) {
      // advance to the null terminator
    }
    return utf8.decode(this.data.subarray(start, this.i - 1))
  }
}

const scratchInt = new Int32Array(1)
const scratchFloat = new Float32Array(scratchInt.buffer)
const utf8 = new TextDecoder()

const PRIMITIVES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'] as const
const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'] as const

interface KiwiField {
  name: string
  /** A primitive name, or an index into the definition list. */
  type: string | number
  isArray: boolean
  value: number
}

interface KiwiDef {
  name: string
  kind: (typeof KINDS)[number]
  fields: KiwiField[]
  enumByValue?: Map<number, string>
}

function decodeSchema(bytes: Uint8Array): KiwiDef[] {
  const r = new Reader(bytes)
  const count = r.varUint()
  const defs: KiwiDef[] = []
  for (let i = 0; i < count; i++) {
    const name = r.string()
    const kind = KINDS[r.byte()]
    const fieldCount = r.varUint()
    const fields: KiwiField[] = []
    for (let j = 0; j < fieldCount; j++) {
      const fieldName = r.string()
      const type = r.varInt()
      const isArray = !!(r.byte() & 1)
      const value = r.varUint()
      fields.push({ name: fieldName, type: type < 0 ? PRIMITIVES[~type] : type, isArray, value })
    }
    defs.push({ name, kind, fields })
  }
  for (const def of defs) {
    if (def.kind === 'ENUM') def.enumByValue = new Map(def.fields.map((f) => [f.value, f.name]))
  }
  return defs
}

type KiwiValue = unknown
type KiwiRecord = Record<string, KiwiValue>

function decodeValue(defs: KiwiDef[], type: string | number, r: Reader): KiwiValue {
  if (typeof type === 'string') {
    switch (type) {
      case 'bool':
        return !!r.byte()
      case 'byte':
        return r.byte()
      case 'int':
        return r.varInt()
      case 'uint':
        return r.varUint()
      case 'float':
        return r.varFloat()
      case 'string':
        return r.string()
      case 'int64':
        return r.varInt64()
      case 'uint64':
        return r.varUint64()
    }
    throw new Error(`kiwi: unknown primitive ${type}`)
  }
  const def = defs[type]
  if (!def) throw new Error(`kiwi: unknown type index ${type}`)
  if (def.kind === 'ENUM') {
    const v = r.varUint()
    return def.enumByValue?.get(v) ?? v
  }
  return decodeRecord(defs, def, r)
}

function decodeField(defs: KiwiDef[], field: KiwiField, r: Reader): KiwiValue {
  if (!field.isArray) return decodeValue(defs, field.type, r)
  if (field.type === 'byte') return r.byteArray()
  const length = r.varUint()
  const out: KiwiValue[] = new Array(length)
  for (let i = 0; i < length; i++) out[i] = decodeValue(defs, field.type, r)
  return out
}

function decodeRecord(defs: KiwiDef[], def: KiwiDef, r: Reader): KiwiRecord {
  const result: KiwiRecord = {}
  if (def.kind === 'STRUCT') {
    for (const field of def.fields) result[field.name] = decodeField(defs, field, r)
    return result
  }
  // MESSAGE: a stream of (field id, value) pairs terminated by id 0.
  while (true) {
    const id = r.varUint()
    if (id === 0) return result
    const field = def.fields.find((f) => f.value === id)
    if (!field) throw new Error(`kiwi: unknown field id ${id} in ${def.name}`)
    result[field.name] = decodeField(defs, field, r)
  }
}

function decodeMessage(defs: KiwiDef[], bytes: Uint8Array): KiwiRecord {
  const root = defs.find((d) => d.name === 'Message' && d.kind === 'MESSAGE')
  if (!root) throw new Error('kiwi: schema has no Message definition')
  return decodeRecord(defs, root, new Reader(bytes))
}

// ---- Figma scene → IR ----

type Fig = Record<string, any>

const CONTAINER_TYPES = new Set(['DOCUMENT', 'CANVAS'])
const SKIP_TYPES = new Set(['SLICE', 'CONNECTOR', 'WIDGET', 'STAMP', 'SECTION_OVERLAY', 'WASHI_TAPE'])

function guidKey(guid: Fig | undefined): string {
  return guid ? `${guid.sessionID ?? 0}:${guid.localID ?? 0}` : ''
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function channel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

/** First visible solid paint as a CSS color; image/gradient paints fall back to a swatch. */
function paintColor(paints: Fig[] | undefined): string | null {
  if (!paints) return null
  for (const paint of paints) {
    if (paint?.visible === false) continue
    const solid = paint?.type === 'SOLID' ? paint.color : paint?.stops?.[0]?.color
    if (solid) {
      const alpha = (solid.a ?? 1) * (paint.opacity ?? 1)
      const [red, green, blue] = [channel(solid.r ?? 0), channel(solid.g ?? 0), channel(solid.b ?? 0)]
      if (alpha >= 0.995) {
        return `#${[red, green, blue].map((c) => c.toString(16).padStart(2, '0')).join('')}`
      }
      return `rgba(${red}, ${green}, ${blue}, ${Math.round(alpha * 1000) / 1000})`
    }
    if (paint?.type === 'IMAGE') return '#d9d9d9'
  }
  return null
}

const WEIGHT_WORDS: [RegExp, TextStyle['fontWeight']][] = [
  [/extra\s*bold|ultra\s*bold|black|heavy/, 800],
  [/semi\s*bold|demi/, 600],
  [/bold/, 700],
  [/medium/, 500],
]

function fontWeight(fontName: Fig | undefined, variations: Fig[] | undefined): TextStyle['fontWeight'] {
  const wght = variations?.find((v) => v.axisName === 'wght' || v.axisTag === 0x77676874)?.value
  if (typeof wght === 'number' && wght > 0) {
    const steps: TextStyle['fontWeight'][] = [400, 500, 600, 700, 800]
    let best = steps[0]
    for (const s of steps) if (Math.abs(s - wght) < Math.abs(best - wght)) best = s
    return best
  }
  const style = (fontName?.style ?? '').toLowerCase()
  for (const [re, weight] of WEIGHT_WORDS) if (re.test(style)) return weight
  return 400
}

const SERIF_RE = /serif|georgia|times|garamond|baskerville|caslon|playfair|merriweather|lora|charter|literata/i

function fontFamily(fontName: Fig | undefined): TextStyle['fontFamily'] {
  const family = fontName?.family ?? ''
  if (/mono|courier|consolas|menlo/i.test(family)) return 'mono'
  if (SERIF_RE.test(family) && !/sans/i.test(family)) return 'serif'
  return 'sans'
}

function lineHeightMultiple(lh: Fig | undefined, fontSize: number): number {
  const value = lh?.value
  if (!lh || typeof value !== 'number' || value <= 0) return DEFAULT_TEXT_STYLE.lineHeight
  if (lh.units === 'PERCENT') return r2(value / 100)
  if (lh.units === 'PIXELS') return fontSize > 0 ? r2(value / fontSize) : DEFAULT_TEXT_STYLE.lineHeight
  // RAW is Figma's "auto"; the stored value is only meaningful as a multiple.
  return value >= 0.5 && value <= 3 ? r2(value) : DEFAULT_TEXT_STYLE.lineHeight
}

function letterSpacingPx(ls: Fig | undefined, fontSize: number): number {
  const value = ls?.value
  if (!ls || typeof value !== 'number' || value === 0) return 0
  if (ls.units === 'PERCENT') return r2((fontSize * value) / 100)
  return r2(value)
}

/** "Card 3" and "Card copy 2" are the same kind of thing as "Card". */
function baseName(name: string): string {
  return name.replace(/\s+copy(\s+\d+)?$/i, '').replace(/\s+\d+$/, '')
}

interface SceneIndex {
  byKey: Map<string, Fig>
  childrenOf: Map<string, Fig[]>
}

function indexScene(nodeChanges: Fig[]): SceneIndex {
  const byKey = new Map<string, Fig>()
  const childrenOf = new Map<string, Fig[]>()
  for (const node of nodeChanges) {
    const key = guidKey(node.guid)
    if (key) byKey.set(key, node)
  }
  for (const node of nodeChanges) {
    const parentKey = guidKey(node.parentIndex?.guid)
    if (!parentKey) continue
    const list = childrenOf.get(parentKey)
    if (list) list.push(node)
    else childrenOf.set(parentKey, [node])
  }
  // Figma orders siblings by fractional-index strings that compare bytewise.
  for (const list of childrenOf.values()) {
    list.sort((a, b) => {
      const pa = a.parentIndex?.position ?? ''
      const pb = b.parentIndex?.position ?? ''
      return pa < pb ? -1 : pa > pb ? 1 : 0
    })
  }
  return { byKey, childrenOf }
}

/** Overrides an instance applies to its symbol's descendants, keyed by guid path. */
function overrideMap(node: Fig): Map<string, Fig> {
  const out = new Map<string, Fig>()
  for (const override of node.symbolData?.symbolOverrides ?? []) {
    const guids: Fig[] = override.guidPath?.guids ?? []
    if (!guids.length) continue
    out.set(guids.map(guidKey).join('/'), override)
  }
  return out
}

class SceneConverter {
  constructor(private index: SceneIndex) {}

  /**
   * Convert one Figma node. `ov` is the override scope of the nearest
   * enclosing instance: overridden fields keyed by guid path relative to that
   * instance (paths chain through nested instances, not plain frames).
   */
  convert(raw: Fig, ov: Map<string, Fig>): IrNode | null {
    let node = raw
    if (ov.size) {
      const patch = ov.get(guidKey(raw.guid))
      if (patch) {
        const { guidPath: _ignored, ...fields } = patch
        node = { ...raw, ...fields }
      }
    }
    if (node.visible === false) return null
    if (raw.type === 'INSTANCE') {
      // An instance stores only its overrides; layout, fills and the rest come
      // from the symbol it points at.
      const symbol = this.index.byKey.get(guidKey(raw.symbolData?.symbolID))
      if (symbol) node = { ...symbol, ...node, type: 'INSTANCE', guid: raw.guid, parentIndex: raw.parentIndex }
    }
    const type: string = node.type ?? 'FRAME'
    if (SKIP_TYPES.has(type) || CONTAINER_TYPES.has(type)) return null
    if (type === 'TEXT') return this.text(node)
    return this.frame(node, raw, ov)
  }

  private childScope(raw: Fig, ov: Map<string, Fig>): Map<string, Fig> {
    if (raw.type !== 'INSTANCE') return ov
    // Entering an instance: its own overrides apply relative to the symbol
    // root, and overrides inherited from an outer instance chain through this
    // node's guid, so their keys lose that prefix.
    const merged = overrideMap(raw)
    const prefix = `${guidKey(raw.guid)}/`
    for (const [key, value] of ov) {
      if (key.startsWith(prefix)) merged.set(key.slice(prefix.length), value)
    }
    return merged
  }

  private rawChildren(node: Fig): Fig[] {
    if (node.type === 'INSTANCE') {
      const symbol = this.index.byKey.get(guidKey(node.symbolData?.symbolID))
      return symbol ? this.index.childrenOf.get(guidKey(symbol.guid)) ?? [] : []
    }
    return this.index.childrenOf.get(guidKey(node.guid)) ?? []
  }

  private text(node: Fig): IrText | null {
    const characters: string = node.textData?.characters ?? ''
    if (!characters.trim()) return null
    const fontSize = r2(node.fontSize ?? 14)
    const align: string = node.textAlignHorizontal ?? 'LEFT'
    const style: TextStyle = {
      fontFamily: fontFamily(node.fontName),
      fontSize,
      fontWeight: fontWeight(node.fontName, node.fontVariations),
      lineHeight: lineHeightMultiple(node.lineHeight, fontSize),
      letterSpacing: letterSpacingPx(node.letterSpacing, fontSize),
      color: paintColor(node.fillPaints) ?? DEFAULT_TEXT_STYLE.color,
      textAlign: align === 'CENTER' ? 'center' : align === 'RIGHT' ? 'right' : 'left',
      uppercase: node.textCase === 'UPPER',
    }
    // Auto-named layers ("New York had…") say nothing about the text's role.
    const flatChars = characters.replace(/\s+/g, ' ').trim()
    const flatName = (node.name ?? '').replace(/\s+/g, ' ').trim()
    const truncated = flatName.endsWith('…')
    const stem = truncated ? flatName.slice(0, -1).trimEnd() : flatName
    const autoNamed =
      node.autoRename === true || !stem || stem === flatChars || (truncated && flatChars.startsWith(stem))
    const slug = autoNamed ? '' : sanitize(baseName(node.name))
    const hug = node.textAutoResize === 'WIDTH_AND_HEIGHT'
    return {
      kind: 'text',
      tag: 'text',
      name: node.name || 'Text',
      slug,
      identity: slug,
      x: r2(node.transform?.m02 ?? 0),
      y: r2(node.transform?.m12 ?? 0),
      text: characters,
      style,
      widthMode: hug ? 'hug' : 'fixed',
      width: r2(node.size?.x ?? 240),
      bindable: true,
    }
  }

  private frame(node: Fig, raw: Fig, ov: Map<string, Fig>): IrFrame | null {
    const type: string = node.type ?? 'FRAME'
    const width = r2(node.size?.x ?? 100)
    let height = r2(node.size?.y ?? 100)

    const scope = this.childScope(raw, ov)
    const pairs: [Fig, IrNode][] = []
    for (const child of this.rawChildren(node)) {
      const converted = this.convert(child, scope)
      if (converted) pairs.push([child, converted])
    }
    const children = pairs.map(([, ir]) => ir)

    const stackMode: string = node.stackMode ?? 'NONE'
    let autoLayout: AutoLayout | null = null
    let widthMode: SizeMode = 'fixed'
    let heightMode: SizeMode = 'fixed'
    if (stackMode === 'HORIZONTAL' || stackMode === 'VERTICAL') {
      const row = stackMode === 'HORIZONTAL'
      const align: string = node.stackCounterAlignItems ?? 'MIN'
      const justify: string = node.stackPrimaryAlignItems ?? 'MIN'
      autoLayout = {
        direction: row ? 'row' : 'column',
        gap: Math.max(0, r2(node.stackSpacing ?? 0)),
        paddingX: Math.max(0, r2(node.stackHorizontalPadding ?? 0)),
        paddingY: Math.max(0, r2(node.stackVerticalPadding ?? 0)),
        align: align === 'CENTER' ? 'center' : align === 'MAX' ? 'end' : 'start',
        justify:
          justify === 'CENTER' ? 'center' : justify === 'MAX' ? 'end' : justify === 'SPACE_EVENLY' ? 'between' : 'start',
        wrap: node.stackWrap === 'WRAP',
      }
      const primaryHug = typeof node.stackPrimarySizing === 'string' && node.stackPrimarySizing !== 'FIXED'
      const counterHug = typeof node.stackCounterSizing === 'string' && node.stackCounterSizing !== 'FIXED'
      widthMode = (row ? primaryHug : counterHug) ? 'hug' : 'fixed'
      heightMode = (row ? counterHug : primaryHug) ? 'hug' : 'fixed'
      // Children of an auto layout flow instead of sitting at absolute spots;
      // their grow/stretch flags become fill modes on the matching axis.
      for (const [rawChild, ir] of pairs) {
        ir.x = 0
        ir.y = 0
        const grow = (rawChild.stackChildPrimaryGrow ?? 0) > 0
        const stretch = rawChild.stackChildAlignSelf === 'STRETCH'
        if (ir.kind === 'frame') {
          if (row ? grow : stretch) ir.widthMode = 'fill'
          if (row ? stretch : grow) ir.heightMode = 'fill'
        } else if (row ? grow : stretch) {
          ir.widthMode = 'fill'
        }
      }
    }

    const stroke = paintColor(node.strokePaints)
    let fill = paintColor(node.fillPaints)
    const isShape = !children.length && type !== 'FRAME' && type !== 'SYMBOL' && type !== 'INSTANCE' && type !== 'GROUP'
    if (isShape && !fill) fill = stroke ?? '#d9d9d9'
    if (type === 'LINE') height = Math.max(height, r2(node.strokeWeight ?? 1))
    const slugBase = sanitize(baseName(node.name ?? ''))
    const symbolKey = guidKey(node.symbolData?.symbolID)
    return {
      kind: 'frame',
      tag: type.toLowerCase(),
      name: node.name || 'Frame',
      slug: slugBase,
      identity: symbolKey ? `sym-${symbolKey}` : slugBase,
      x: r2(node.transform?.m02 ?? 0),
      y: r2(node.transform?.m12 ?? 0),
      children,
      fill,
      cornerRadius: type === 'ELLIPSE' ? r2(Math.min(width, height) / 2) : r2(node.cornerRadius ?? 0),
      autoLayout,
      widthMode,
      heightMode,
      width,
      height,
      stroke: isShape ? null : stroke,
      strokeWidth: r2(node.strokeWeight ?? 1),
      clip: (type === 'FRAME' || type === 'SYMBOL' || type === 'INSTANCE') && node.frameMaskDisabled !== true,
      styleWidth: null,
      stylePadX: null,
      stylePadY: null,
      styleGap: null,
    }
  }
}

// ---- layout inference for hand-placed repeats ----

const POS_TOL = 4
const GAP_TOL = 6

interface Box {
  ir: IrNode
  x: number
  y: number
  w: number
  h: number
}

function gapsAreUniform(gaps: number[]): boolean {
  if (!gaps.length) return true
  const min = Math.min(...gaps)
  const max = Math.max(...gaps)
  return min >= -2 && max - min <= GAP_TOL
}

function toRow(frame: IrFrame, boxes: Box[], gap: number, wrap: boolean): void {
  frame.autoLayout = {
    direction: 'row',
    gap: Math.max(0, r2(gap)),
    paddingX: Math.max(0, Math.round(Math.min(...boxes.map((b) => b.x)))),
    paddingY: Math.max(0, Math.round(Math.min(...boxes.map((b) => b.y)))),
    align: 'start',
    justify: 'start',
    wrap,
  }
  frame.heightMode = 'hug'
  frame.children = boxes.map((b) => b.ir)
  for (const child of frame.children) {
    child.x = 0
    child.y = 0
  }
}

/**
 * Cards laid out by hand — no auto layout — still read as a row, column or grid
 * when their geometry is regular. Detecting that lets the same repeated-sibling
 * collapse work on Figma pastes that never used auto layout. Only frames whose
 * children already look like a repeat are rewritten, so freeform layouts are
 * left untouched.
 */
export function inferRepeatLayout(frame: IrFrame): void {
  for (const child of frame.children) if (child.kind === 'frame') inferRepeatLayout(child)
  if (frame.autoLayout || frame.children.length < 3) return
  if (!frame.children.every((c) => c.kind === 'frame')) return
  if (!isRepeatCandidate(frame.children)) return

  const boxes: Box[] = (frame.children as IrFrame[]).map((ir) => ({
    ir,
    x: ir.x ?? 0,
    y: ir.y ?? 0,
    w: ir.width,
    h: ir.height,
  }))

  // Single row: everything on one baseline, evenly spaced.
  const minY = Math.min(...boxes.map((b) => b.y))
  if (boxes.every((b) => Math.abs(b.y - minY) <= POS_TOL)) {
    const sorted = [...boxes].sort((a, b) => a.x - b.x)
    const gaps = sorted.slice(1).map((b, i) => b.x - (sorted[i].x + sorted[i].w))
    if (gapsAreUniform(gaps)) toRow(frame, sorted, gaps[0] ?? 0, false)
    return
  }

  // Single column.
  const minX = Math.min(...boxes.map((b) => b.x))
  if (boxes.every((b) => Math.abs(b.x - minX) <= POS_TOL)) {
    const sorted = [...boxes].sort((a, b) => a.y - b.y)
    const gaps = sorted.slice(1).map((b, i) => b.y - (sorted[i].y + sorted[i].h))
    if (!gapsAreUniform(gaps)) return
    frame.autoLayout = {
      direction: 'column',
      gap: Math.max(0, r2(gaps[0] ?? 0)),
      paddingX: Math.max(0, Math.round(minX)),
      paddingY: Math.max(0, Math.round(Math.min(...boxes.map((b) => b.y)))),
      align: 'start',
      justify: 'start',
      wrap: false,
    }
    frame.heightMode = 'hug'
    frame.children = sorted.map((b) => b.ir)
    for (const child of frame.children) {
      child.x = 0
      child.y = 0
    }
    return
  }

  // Grid: same-sized cells in aligned rows of equal length becomes a wrapping row.
  const w0 = boxes[0].w
  const h0 = boxes[0].h
  if (!boxes.every((b) => Math.abs(b.w - w0) <= POS_TOL && Math.abs(b.h - h0) <= POS_TOL)) return
  const rows: Box[][] = []
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(box.y - row[0].y) <= POS_TOL) row.push(box)
    else rows.push([box])
  }
  if (rows.length < 2 || rows.some((row) => row.length !== rows[0].length)) return
  const colGaps: number[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) colGaps.push(row[i].x - (row[i - 1].x + row[i - 1].w))
  }
  const rowGaps = rows.slice(1).map((row, i) => row[0].y - (rows[i][0].y + h0))
  if (!gapsAreUniform(colGaps) || !gapsAreUniform(rowGaps)) return
  // Our auto layout has a single gap for both axes, so only near-square
  // spacing survives the rewrite faithfully.
  const colGap = colGaps[0] ?? 0
  const rowGap = rowGaps[0] ?? 0
  if (Math.abs(colGap - rowGap) > Math.max(GAP_TOL, colGap * 0.5)) return
  toRow(frame, rows.flat(), (colGap + rowGap) / 2, true)
}

// ---- entry point ----

export async function importFigmaClipboard(
  html: string,
  existingDataKeys: string[],
): Promise<ImportResult | null> {
  const bytes = extractFigBytes(html)
  if (!bytes) return null
  const chunks = parseArchive(bytes)
  if (chunks.length < 2) throw new Error('missing data chunks')
  const [schemaBytes, dataBytes] = await Promise.all([inflate(chunks[0]), inflate(chunks[1])])
  const defs = decodeSchema(schemaBytes)
  const message = decodeMessage(defs, dataBytes)
  const nodeChanges = (message.nodeChanges as Fig[] | undefined) ?? []
  if (!nodeChanges.length) return null

  const index = indexScene(nodeChanges)
  const converter = new SceneConverter(index)

  // Symbols referenced by pasted instances ride along as dependencies; they are
  // not themselves part of what was copied.
  const referencedSymbols = new Set<string>()
  for (const node of nodeChanges) {
    if (node.type === 'INSTANCE') {
      const key = guidKey(node.symbolData?.symbolID)
      if (key) referencedSymbols.add(key)
    }
  }

  const rootFigs = nodeChanges.filter((node) => {
    const type: string = node.type ?? ''
    if (!type || CONTAINER_TYPES.has(type) || SKIP_TYPES.has(type)) return false
    if (type === 'SYMBOL' && referencedSymbols.has(guidKey(node.guid))) return false
    const parent = index.byKey.get(guidKey(node.parentIndex?.guid))
    return !parent || CONTAINER_TYPES.has(parent.type ?? '')
  })

  const emptyOverrides = new Map<string, Fig>()
  const pairs: [Fig, IrNode][] = []
  for (const fig of rootFigs) {
    const ir = converter.convert(fig, emptyOverrides)
    if (ir) pairs.push([fig, ir])
  }
  if (!pairs.length) return null

  let root: IrFrame
  if (pairs.length === 1 && pairs[0][1].kind === 'frame') {
    root = pairs[0][1] as IrFrame
  } else {
    // Several top-level layers keep their relative canvas positions inside a
    // plain wrapper frame.
    const boxes = pairs.map(([fig, ir]) => ({
      ir,
      x: r2(fig.transform?.m02 ?? 0),
      y: r2(fig.transform?.m12 ?? 0),
      w: r2(fig.size?.x ?? 100),
      h: r2(fig.size?.y ?? 24),
    }))
    const minX = Math.min(...boxes.map((b) => b.x))
    const minY = Math.min(...boxes.map((b) => b.y))
    for (const box of boxes) {
      box.ir.x = r2(box.x - minX)
      box.ir.y = r2(box.y - minY)
    }
    root = {
      kind: 'frame',
      tag: 'frame',
      name: 'Figma paste',
      slug: '',
      identity: '',
      children: boxes.map((b) => b.ir),
      fill: null,
      cornerRadius: 0,
      autoLayout: null,
      widthMode: 'fixed',
      heightMode: 'fixed',
      width: r2(Math.max(...boxes.map((b) => b.x + b.w)) - minX),
      height: r2(Math.max(...boxes.map((b) => b.y + b.h)) - minY),
      styleWidth: null,
      stylePadX: null,
      stylePadY: null,
      styleGap: null,
    }
  }
  root.x = 0
  root.y = 0
  if (root.widthMode === 'fill') root.widthMode = 'fixed'
  if (root.heightMode === 'fill') root.heightMode = 'fixed'

  inferRepeatLayout(root)
  return finishImport(root, existingDataKeys)
}
