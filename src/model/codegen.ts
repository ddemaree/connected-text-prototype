import { componentFields, getByPath } from './resolve'
import { describeConstraint, intentLabel, pathLeaf, type DerivedSchema, type SchemaField, type SchemaType } from './schema'
import type { DesignDoc, NodeId, OverrideValue } from './types'

function pascalCase(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function camelCase(s: string): string {
  const p = pascalCase(s)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

/** "Articles" → "Article", "Stories" → "Story". Good enough for generated types. */
function singular(s: string): string {
  if (/ies$/.test(s)) return s.slice(0, -3) + 'y'
  if (/(s|x|z|ch|sh)es$/.test(s)) return s.slice(0, -2)
  if (/[^s]s$/.test(s)) return s.slice(0, -1)
  return s
}

/** The generated TypeScript name for a schema type. */
export function interfaceName(type: SchemaType): string {
  switch (type.kind) {
    case 'collection':
      return singular(pascalCase(type.key)) || 'Item'
    case 'component':
      return `${pascalCase(type.name) || 'Component'}Props`
    case 'singleton':
      return pascalCase(type.name) || 'Section'
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function propKey(name: string): string {
  return IDENTIFIER.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`
}

function fieldDoc(field: SchemaField): string {
  const parts: string[] = []
  const description = field.description?.trim()
  if (description) parts.push(description)
  else if (field.intent !== 'custom') parts.push(intentLabel(field.intent))
  const constraint = describeConstraint(field.constraint)
  if (constraint) parts.push(constraint)
  return parts.join(' · ')
}

export function typeInterface(type: SchemaType): string {
  const name = interfaceName(type)
  if (!type.fields.length) return `export interface ${name} {}`
  const lines = [`export interface ${name} {`]
  for (const field of type.fields) {
    const doc = fieldDoc(field)
    if (doc) lines.push(`  /** ${doc} */`)
    lines.push(`  ${propKey(field.name)}: ${field.type}`)
  }
  lines.push('}')
  return lines.join('\n')
}

export function tsInterfaces(schema: DerivedSchema): string {
  if (!schema.types.length) {
    return '// Nothing structured yet — mark text layers as content fields to build a schema.'
  }
  return schema.types.map(typeInterface).join('\n\n')
}

function castValue(field: SchemaField): string | number | boolean {
  if (field.type === 'number') {
    const n = Number(field.sampleValue)
    return Number.isFinite(n) ? n : 0
  }
  if (field.type === 'boolean') return field.sampleValue.trim().toLowerCase() === 'true'
  return field.sampleValue
}

function sampleObject(type: SchemaType): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of type.fields) out[field.name] = castValue(field)
  return out
}

/** Project a real collection item onto the schema's field names. */
function projectItem(type: SchemaType, item: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of type.fields) {
    const key = (field.bindingPath ? pathLeaf(field.bindingPath) : '') || field.name
    const value = getByPath(item, key)
    out[field.name] = value === undefined ? castValue(field) : value
  }
  return out
}

function collectionPathOf(type: SchemaType, doc: DesignDoc): string | null {
  const source = doc.nodes[type.sourceId]
  if (source?.type !== 'frame' || source.repeat?.mode !== 'collection') return null
  return source.repeat.path
}

export function sampleJson(schema: DerivedSchema, doc: DesignDoc): string {
  const out: Record<string, unknown> = {}
  for (const type of schema.types) {
    if (type.kind !== 'collection') {
      out[type.key] = sampleObject(type)
      continue
    }
    const path = collectionPathOf(type, doc)
    const items = path ? getByPath(doc.data, path) : undefined
    out[type.key] =
      Array.isArray(items) && items.length
        ? items.slice(0, 2).map((item) => projectItem(type, item))
        : [sampleObject(type)]
  }
  return JSON.stringify(out, null, 2)
}

export function fetchSnippet(type: SchemaType): string {
  const name = interfaceName(type)
  switch (type.kind) {
    case 'collection':
      return [
        `// GET /v1/collections/${type.key}`,
        `const ${camelCase(type.key)} = await cms.collection('${type.key}').all()  // ${name}[]`,
      ].join('\n')
    case 'singleton':
      return `const ${camelCase(type.key)} = await cms.singleton('${type.key}').get()  // ${name}`
    case 'component':
      return `// ${pascalCase(type.name)} is consumed via fields, not fetched — see Connected code.`
  }
}

function jsxValue(value: OverrideValue): string {
  switch (value.type) {
    case 'static':
      return JSON.stringify(value.value)
    case 'binding':
      return `{${value.path}}`
    case 'generator':
      return `{generator('${value.config.kind}', ${value.config.count})}`
  }
}

function jsxElement(name: string, attrs: string[]): string {
  if (!attrs.length) return `<${name} />`
  return `<${name}\n${attrs.map((a) => `  ${a}`).join('\n')}\n/>`
}

/**
 * The library code a connected component maps to (Code Connect analog): an
 * instance renders the fields it overrides — the rest fall through to the
 * definition's own defaults — and a definition renders its JSX signature.
 */
export function connectedComponentSnippet(doc: DesignDoc, nodeId: NodeId): string | null {
  const node = doc.nodes[nodeId]
  if (!node) return null
  if (node.type === 'instance') {
    const def = doc.nodes[node.componentId]
    if (def?.type !== 'frame') return null
    const attrs: string[] = []
    for (const { field } of componentFields(doc, def.id)) {
      const override = node.overrides[field.name]
      if (override) attrs.push(`${field.name}=${jsxValue(override)}`)
    }
    return jsxElement(pascalCase(def.name) || 'Component', attrs)
  }
  if (node.type === 'frame' && node.isComponent) {
    const attrs = componentFields(doc, node.id).map(
      ({ field }) => `${field.name}={${camelCase(field.name) || 'value'}}`,
    )
    return jsxElement(pascalCase(node.name) || 'Component', attrs)
  }
  return null
}
