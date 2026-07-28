import {
  DEFAULT_TEXT_STYLE,
  newId,
  type AnyNode,
  type AutoLayout,
  type FrameNode,
  type NodeId,
  type SizeMode,
  type TextNode,
  type TextStyle,
} from './types'

export interface HtmlImportResult {
  /** Every created node, root first, with parentId/children already wired. */
  nodes: AnyNode[]
  rootId: NodeId
  /** Collections extracted from repeated structures, to merge into doc.data. */
  collections: Record<string, unknown[]>
  stats: { layerCount: number; repeaterCount: number; collectionNames: string[] }
}

export const EXAMPLE_HTML = `<header>
  <h1>Field Notes</h1>
  <p class="tagline">Small observations from a year of walking the same three miles.</p>
</header>
<section class="stories">
  <article class="card">
    <h3>Frost on the low meadow</h3>
    <p>The first hard frost came overnight and left the meadow silver until nine, when the sun finally cleared the ridge.</p>
    <span class="author">Elena Duarte</span>
  </article>
  <article class="card">
    <h3>Herons at the culvert</h3>
    <p>Two herons have claimed the culvert below the road. They tolerate each other at a distance of about twelve feet.</p>
    <span class="author">Marcus Bell</span>
  </article>
  <article class="card">
    <h3>The oak that lost its west side</h3>
    <p>March storms took the west limbs of the big oak. The clearing they opened is already thick with foxglove.</p>
    <span class="author">Priya Raman</span>
  </article>
  <article class="card">
    <h3>Counting swifts at dusk</h3>
    <p>Thirty-one swifts over the chimney at 8:40, down from forty last summer. I have started keeping a tally card.</p>
    <span class="author">Tomas Lindqvist</span>
  </article>
</section>`

const SKIP_TAGS = new Set([
  'script',
  'style',
  'head',
  'meta',
  'link',
  'title',
  'svg',
  'iframe',
  'video',
  'audio',
  'input',
  'select',
  'textarea',
  'noscript',
  'template',
  'canvas',
  'object',
  'embed',
  'source',
  'track',
])

const BLOCK_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'ul',
  'ol',
  'figure',
  'form',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'figcaption',
  'caption',
  'dl',
  'dt',
  'dd',
  'address',
  'fieldset',
  'hgroup',
  'details',
  'summary',
])

const INLINE_TAGS = new Set([
  'a',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'small',
  'br',
  'u',
  's',
  'mark',
  'sub',
  'sup',
  'abbr',
  'time',
  'label',
  'q',
  'cite',
  'del',
  'ins',
  'kbd',
  'samp',
  'var',
])

/** Tag → text style deltas layered on top of DEFAULT_TEXT_STYLE. */
const TEXT_STYLES: Record<string, Partial<TextStyle>> = {
  h1: { fontSize: 32, fontWeight: 700, lineHeight: 1.15 },
  h2: { fontSize: 26, fontWeight: 700, lineHeight: 1.2 },
  h3: { fontSize: 21, fontWeight: 600, lineHeight: 1.25 },
  h4: { fontSize: 17, fontWeight: 600 },
  h5: { fontSize: 14, fontWeight: 600 },
  h6: { fontSize: 14, fontWeight: 600 },
  p: { fontSize: 15, fontWeight: 400, lineHeight: 1.5, color: '#3d3d3d' },
  li: { fontSize: 15, fontWeight: 400 },
  small: { fontSize: 12, fontWeight: 400, color: '#8a8a8a' },
  figcaption: { fontSize: 12, fontWeight: 400, color: '#8a8a8a' },
  caption: { fontSize: 12, fontWeight: 400, color: '#8a8a8a' },
  blockquote: { fontSize: 17, fontWeight: 400, color: '#555555' },
  a: { color: '#1e66d0' },
  pre: { fontFamily: 'mono', fontSize: 13 },
  code: { fontFamily: 'mono', fontSize: 13 },
}

const TEXT_NAMES: Record<string, string> = {
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Paragraph',
  li: 'List item',
  a: 'Link',
  small: 'Caption',
  figcaption: 'Caption',
  caption: 'Caption',
  blockquote: 'Quote',
  pre: 'Code',
  code: 'Code',
  span: 'Label',
  strong: 'Label',
  em: 'Label',
  b: 'Label',
  i: 'Label',
  time: 'Label',
}

const FRAME_NAMES: Record<string, string> = {
  section: 'Section',
  article: 'Article',
  header: 'Header',
  footer: 'Footer',
  nav: 'Nav',
  main: 'Main',
  aside: 'Aside',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  figure: 'Figure',
  form: 'Form',
  blockquote: 'Quote',
  div: 'Frame',
}

const FIELD_NAMES: Record<string, string> = {
  h1: 'title',
  h2: 'title',
  h3: 'title',
  h4: 'title',
  h5: 'title',
  h6: 'title',
  p: 'body',
  a: 'link',
  small: 'meta',
  figcaption: 'meta',
  caption: 'meta',
  blockquote: 'body',
  li: 'body',
}

// ---- intermediate representation ----
// Elements are converted to this tree first so repetition can be detected and
// rewritten before any node ids exist.

interface IrCommon {
  /** Tag the node was derived from; drives naming, styling and signatures. */
  tag: string
  name: string
  /** Sanitized first class (or id), used for field and collection names. */
  slug: string
}

interface IrText extends IrCommon {
  kind: 'text'
  text: string
  style: TextStyle
  widthMode: SizeMode
  /** Button labels stay static: they are chrome, not item content. */
  bindable: boolean
  binding?: string
}

interface IrFrame extends IrCommon {
  kind: 'frame'
  children: IrNode[]
  fill: string | null
  cornerRadius: number
  autoLayout: AutoLayout
  widthMode: SizeMode
  heightMode: SizeMode
  width: number
  height: number
  /** Inline-style values kept raw so the root can fall back to its own defaults. */
  styleWidth: number | null
  stylePadX: number | null
  stylePadY: number | null
  styleGap: number | null
  repeatPath?: string
}

type IrNode = IrText | IrFrame

// ---- inline style parsing ----

function parseInlineStyle(el: Element | null | undefined): Record<string, string> {
  const raw = el?.getAttribute('style')
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const key = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

function pxValue(v: string | undefined): number | null {
  if (!v) return null
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i
const NON_COLORS = new Set(['transparent', 'none', 'inherit', 'initial', 'unset', 'currentcolor'])

function parseColor(v: string | undefined): string | null {
  if (!v) return null
  const t = v.trim()
  if (!COLOR_RE.test(t) || NON_COLORS.has(t.toLowerCase())) return null
  return t
}

function parseFill(style: Record<string, string>): string | null {
  return (
    parseColor(style['background-color']) ??
    parseColor(style['background']) ??
    parseColor(style['background']?.split(/\s+/)[0])
  )
}

/** Padding shorthand + longhands, reduced to the single X/Y pair auto layout has. */
function parsePadding(style: Record<string, string>): { x: number | null; y: number | null } {
  let top: number | null = null
  let left: number | null = null
  const short = style['padding']
  if (short) {
    const parts = short.split(/\s+/).map(pxValue)
    if (parts.length === 1) {
      top = parts[0]
      left = parts[0]
    } else if (parts.length > 1) {
      top = parts[0]
      left = parts.length >= 4 ? parts[3] : parts[1]
    }
  }
  const t = pxValue(style['padding-top']) ?? pxValue(style['padding-bottom'])
  const l = pxValue(style['padding-left']) ?? pxValue(style['padding-right'])
  if (t !== null) top = t
  if (l !== null) left = l
  return { x: left, y: top }
}

const WEIGHTS: TextStyle['fontWeight'][] = [400, 500, 600, 700, 800]

function parseWeight(v: string | undefined): TextStyle['fontWeight'] | null {
  if (!v) return null
  const t = v.trim().toLowerCase()
  if (t === 'bold' || t === 'bolder') return 700
  if (t === 'normal' || t === 'lighter') return 400
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  let best = WEIGHTS[0]
  for (const w of WEIGHTS) if (Math.abs(w - n) < Math.abs(best - n)) best = w
  return best
}

function parseLineHeight(v: string | undefined, fontSize: number): number | null {
  if (!v) return null
  const t = v.trim()
  if (t.endsWith('%')) {
    const pct = parseFloat(t)
    return Number.isFinite(pct) ? pct / 100 : null
  }
  if (t.endsWith('px')) {
    const px = pxValue(t)
    return px !== null && fontSize > 0 ? px / fontSize : null
  }
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function applyInlineTextStyle(style: TextStyle, el: Element | null | undefined): TextStyle {
  const s = parseInlineStyle(el)
  if (!Object.keys(s).length) return style
  const next = { ...style }
  const size = pxValue(s['font-size'])
  if (size !== null && size > 0) next.fontSize = size
  const weight = parseWeight(s['font-weight'])
  if (weight !== null) next.fontWeight = weight
  const color = parseColor(s['color'])
  if (color) next.color = color
  const align = s['text-align']?.trim().toLowerCase()
  if (align === 'left' || align === 'center' || align === 'right') next.textAlign = align
  const lh = parseLineHeight(s['line-height'], next.fontSize)
  if (lh !== null && lh > 0) next.lineHeight = lh
  const ls = pxValue(s['letter-spacing'])
  if (ls !== null) next.letterSpacing = ls
  if (s['text-transform']?.trim().toLowerCase() === 'uppercase') next.uppercase = true
  return next
}

// ---- element helpers ----

function sanitize(v: string | null | undefined): string {
  if (!v) return ''
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function slugFor(el: Element | null | undefined): string {
  if (!el) return ''
  const cls = el.getAttribute('class')?.trim().split(/\s+/)[0]
  return sanitize(cls) || sanitize(el.getAttribute('id'))
}

function tagOf(node: Node): string {
  return (node as Element).tagName.toLowerCase()
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE
}

/** Known block tags are blocks; unknown tags are blocks only if they wrap blocks. */
function isBlockElement(el: Element): boolean {
  const tag = tagOf(el)
  if (BLOCK_TAGS.has(tag)) return true
  if (INLINE_TAGS.has(tag) || tag === 'img' || tag === 'button') return false
  for (const child of Array.from(el.children)) {
    const t = tagOf(child)
    if (SKIP_TAGS.has(t)) continue
    if (t === 'img' || t === 'button' || isBlockElement(child)) return true
  }
  return false
}

function isInlineChild(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (!isElement(node)) return false
  const tag = tagOf(node)
  if (tag === 'img' || tag === 'button') return false
  return !isBlockElement(node)
}

/** Child nodes that carry content: text and non-skipped elements. */
function contentChildren(el: Element): Node[] {
  return Array.from(el.childNodes).filter((n) => {
    if (n.nodeType === Node.TEXT_NODE) return true
    if (!isElement(n)) return false
    return !SKIP_TAGS.has(tagOf(n))
  })
}

function singleElementChild(el: Element): Element | null {
  const els = contentChildren(el).filter(isElement)
  return els.length === 1 ? els[0] : null
}

/** Flatten inline markup to a string: whitespace collapsed, <br> → newline. */
function inlineText(nodes: Node[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ')
      continue
    }
    if (!isElement(node)) continue
    const tag = tagOf(node)
    if (SKIP_TAGS.has(tag)) continue
    if (tag === 'br') {
      out += '\n'
      continue
    }
    out += inlineText(Array.from(node.childNodes))
  }
  return out
}

function cleanText(raw: string): string {
  return raw.replace(/[ \t]*\n[ \t]*/g, '\n').trim()
}

function textName(tag: string, slug: string): string {
  return TEXT_NAMES[tag] ?? (slug ? slug : 'Text')
}

function frameName(el: Element, slug: string): string {
  const tag = tagOf(el)
  return slug || FRAME_NAMES[tag] || tag
}

// ---- element → IR ----

function makeText(
  tag: string,
  slug: string,
  text: string,
  styleEls: (Element | null | undefined)[],
): IrText {
  let style: TextStyle = { ...DEFAULT_TEXT_STYLE, ...TEXT_STYLES[tag] }
  for (const el of styleEls) style = applyInlineTextStyle(style, el)
  return {
    kind: 'text',
    tag,
    name: textName(tag, slug),
    slug,
    text,
    style,
    widthMode: 'fill',
    bindable: true,
  }
}

/** A block whose content is entirely inline collapses to one text node. */
function textFromElement(el: Element): IrText | null {
  const text = cleanText(inlineText(Array.from(el.childNodes)))
  if (!text) return null
  const tag = tagOf(el)
  const inner = singleElementChild(el)
  const innerTag = inner ? tagOf(inner) : null
  // A generic wrapper around a single inline element takes that element's identity.
  const styleTag = innerTag && !(tag in TEXT_STYLES) ? innerTag : tag
  const slug = slugFor(el) || slugFor(inner)
  return makeText(styleTag, slug, text, inner ? [el, inner] : [el])
}

/**
 * Sibling inline elements with nothing but whitespace between them are separate
 * pieces of content (`<span class="name">…<span class="price">…`), so they stay
 * separate text nodes in a row instead of merging into one string.
 */
function inlineRowChildren(el: Element): Element[] | null {
  const kids = contentChildren(el)
  const els = kids.filter(isElement)
  if (!els.length || !els.every((child) => INLINE_TAGS.has(tagOf(child)))) return null
  const parts = els.filter((child) => tagOf(child) !== 'br')
  if (parts.length < 2) return null
  if (kids.some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())) return null
  return parts
}

/** A stretch of inline content sitting between block siblings. */
function textFromRun(run: Node[]): IrText | null {
  const text = cleanText(inlineText(run))
  if (!text) return null
  const els = run.filter(isElement).filter((el) => tagOf(el) !== 'br')
  const src = els.length === 1 ? els[0] : null
  const tag = src ? tagOf(src) : 'span'
  return makeText(tag, slugFor(src), text, [src])
}

function makeFrame(el: Element | null, children: IrNode[], name: string, slug: string): IrFrame {
  const style = parseInlineStyle(el)
  const pad = parsePadding(style)
  const tag = el ? tagOf(el) : 'div'
  const isList = tag === 'ul' || tag === 'ol'
  const row =
    !isList &&
    style['display']?.trim().toLowerCase() === 'flex' &&
    (style['flex-direction'] ?? 'row').trim().toLowerCase() === 'row'
  return {
    kind: 'frame',
    tag,
    name,
    slug,
    children,
    fill: parseFill(style),
    cornerRadius: pxValue(style['border-radius']) ?? 0,
    autoLayout: {
      direction: row ? 'row' : 'column',
      gap: pxValue(style['gap']) ?? 8,
      paddingX: pad.x ?? 0,
      paddingY: pad.y ?? 0,
      align: 'start',
      justify: 'start',
      wrap: false,
    },
    widthMode: 'fill',
    heightMode: 'hug',
    width: 240,
    height: 100,
    styleWidth: pxValue(style['width']),
    stylePadX: pad.x,
    stylePadY: pad.y,
    styleGap: pxValue(style['gap']),
  }
}

function imageFrame(el: Element): IrFrame {
  const style = parseInlineStyle(el)
  const height = pxValue(style['height']) ?? pxValue(el.getAttribute('height') ?? undefined) ?? 160
  const slug = slugFor(el)
  const frame = makeFrame(null, [], 'Image', slug)
  frame.tag = 'img'
  frame.fill = '#d9d9d9'
  frame.cornerRadius = 6
  frame.heightMode = 'fixed'
  frame.height = height
  return frame
}

function buttonFrame(el: Element): IrFrame {
  const label = cleanText(inlineText(Array.from(el.childNodes))) || 'Button'
  const slug = slugFor(el)
  const frame = makeFrame(null, [], slug || 'Button', slug)
  frame.tag = 'button'
  frame.fill = '#1e66d0'
  frame.cornerRadius = 6
  frame.widthMode = 'hug'
  frame.autoLayout = { direction: 'row', gap: 8, paddingX: 16, paddingY: 8, align: 'center', justify: 'center', wrap: false }
  const text = makeText('button', '', label, [])
  text.name = 'Button label'
  text.style = { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: 600, color: '#ffffff' }
  text.widthMode = 'hug'
  text.bindable = false
  frame.children = [text]
  return frame
}

function convertElement(el: Element): IrNode | null {
  const tag = tagOf(el)
  if (SKIP_TAGS.has(tag)) return null
  if (tag === 'img') return imageFrame(el)
  if (tag === 'button') return buttonFrame(el)
  if (!isBlockElement(el)) return textFromRun([el])
  if (contentChildren(el).every(isInlineChild)) {
    const row = inlineRowChildren(el)
    const parts = row ? row.map((child) => textFromRun([child])).filter((t): t is IrText => !!t) : []
    if (parts.length < 2) return textFromElement(el)
    const slug = slugFor(el)
    const frame = makeFrame(el, parts, frameName(el, slug), slug)
    frame.fill = null
    frame.autoLayout = { direction: 'row', gap: 8, paddingX: 0, paddingY: 0, align: 'center', justify: 'start', wrap: false }
    return frame
  }
  const children = convertChildren(el)
  if (!children.length) return null
  const slug = slugFor(el)
  return makeFrame(el, children, frameName(el, slug), slug)
}

function convertChildren(el: Element): IrNode[] {
  const out: IrNode[] = []
  let run: Node[] = []
  const flush = () => {
    if (!run.length) return
    const text = textFromRun(run)
    if (text) out.push(text)
    run = []
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      run.push(node)
      continue
    }
    if (!isElement(node)) continue
    if (SKIP_TAGS.has(tagOf(node))) continue
    if (isInlineChild(node)) {
      run.push(node)
      continue
    }
    flush()
    const converted = convertElement(node)
    if (converted) out.push(converted)
  }
  flush()
  return out
}

// ---- repetition detection ----

/** Shape only: tags and nesting, never text or style. */
function signature(node: IrNode): string {
  if (node.kind === 'text') return `t:${node.tag}`
  return `f:${node.tag}(${node.children.map(signature).join(',')})`
}

function collectSlots(node: IrNode, out: IrText[] = []): IrText[] {
  if (node.kind === 'text') {
    if (node.bindable) out.push(node)
    return out
  }
  for (const child of node.children) collectSlots(child, out)
  return out
}

function fieldNamesFor(slots: IrText[]): string[] {
  const used = new Map<string, number>()
  return slots.map((slot) => {
    const base = slot.slug || FIELD_NAMES[slot.tag] || 'label'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}${seen + 1}`
  })
}

function uniqueCollectionName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

interface DetectResult {
  collections: Record<string, unknown[]>
  names: string[]
}

function detectRepeats(frame: IrFrame, used: Set<string>, out: DetectResult): void {
  const kids = frame.children
  if (kids.length >= 3) {
    const sig = signature(kids[0])
    if (kids.every((k) => signature(k) === sig) && collectSlots(kids[0]).length > 0) {
      const template = kids[0]
      const fields = fieldNamesFor(collectSlots(template))
      const items = kids.map((kid) => {
        const slots = collectSlots(kid)
        const item: Record<string, string> = {}
        fields.forEach((field, i) => {
          item[field] = slots[i]?.text ?? ''
        })
        return item
      })
      const name = uniqueCollectionName(frame.slug || 'items', used)
      used.add(name)
      collectSlots(template).forEach((slot, i) => {
        slot.binding = `item.${fields[i]}`
      })
      frame.children = [template]
      frame.repeatPath = name
      out.collections[name] = items
      out.names.push(name)
      // A repeater's template is not searched again: no repeater-in-repeater.
      return
    }
  }
  for (const kid of kids) if (kid.kind === 'frame') detectRepeats(kid, used, out)
}

// ---- IR → nodes ----

function emit(ir: IrNode, parentId: NodeId | null, out: AnyNode[]): NodeId {
  if (ir.kind === 'text') {
    const node: TextNode = {
      id: newId('text'),
      type: 'text',
      name: ir.name,
      parentId,
      x: 0,
      y: 0,
      width: 240,
      height: 24,
      widthMode: ir.widthMode,
      heightMode: 'hug',
      style: ir.style,
      content: ir.binding ? { type: 'binding', path: ir.binding } : { type: 'static', value: ir.text },
    }
    out.push(node)
    return node.id
  }
  const node: FrameNode = {
    id: newId('frame'),
    type: 'frame',
    name: ir.name,
    parentId,
    x: 0,
    y: 0,
    width: ir.width,
    height: ir.height,
    widthMode: ir.widthMode,
    heightMode: ir.heightMode,
    children: [],
    fill: ir.fill,
    stroke: null,
    strokeWidth: 1,
    cornerRadius: ir.cornerRadius,
    shadow: false,
    clip: false,
    autoLayout: ir.autoLayout,
  }
  if (ir.repeatPath) node.repeat = { mode: 'collection', path: ir.repeatPath }
  out.push(node)
  node.children = ir.children.map((child) => emit(child, node.id, out))
  return node.id
}

export function importHtml(html: string, existingDataKeys: string[]): HtmlImportResult | null {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  if (!parsed.body) return null
  const hasElements = Array.from(parsed.body.children).some((el) => !SKIP_TAGS.has(tagOf(el)))
  if (!hasElements) return null
  const tops = convertChildren(parsed.body)
  if (!tops.length) return null

  const first = tops[0]
  let root: IrFrame
  if (tops.length === 1 && first.kind === 'frame') {
    root = first
  } else {
    root = makeFrame(null, tops, 'Imported HTML', '')
  }
  root.widthMode = 'fixed'
  root.width = root.styleWidth ?? 800
  root.heightMode = 'hug'
  root.fill = root.fill ?? '#ffffff'
  root.autoLayout = {
    ...root.autoLayout,
    gap: root.styleGap ?? 16,
    paddingX: root.stylePadX ?? 32,
    paddingY: root.stylePadY ?? 32,
  }

  const detected: DetectResult = { collections: {}, names: [] }
  detectRepeats(root, new Set(existingDataKeys), detected)

  const nodes: AnyNode[] = []
  const rootId = emit(root, null, nodes)

  return {
    nodes,
    rootId,
    collections: detected.collections,
    stats: {
      layerCount: nodes.length,
      repeaterCount: detected.names.length,
      collectionNames: detected.names,
    },
  }
}
