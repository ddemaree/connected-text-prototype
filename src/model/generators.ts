import type { GeneratorConfig, GeneratorKind, GeneratorUnit } from './types'

/** Deterministic PRNG so generated text is stable across renders for a given seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POOLS: Record<GeneratorKind, string[]> = {
  title: [
    'quiet', 'rise', 'future', 'hidden', 'city', 'light', 'making', 'sense', 'work',
    'weather', 'archive', 'signal', 'noise', 'design', 'memory', 'garden', 'machine',
    'paper', 'return', 'slow', 'lost', 'found', 'edge', 'field', 'notes', 'water',
    'season', 'common', 'ground', 'second', 'life', 'small', 'things', 'long', 'road',
  ],
  standfirst: [
    'how', 'a', 'new', 'generation', 'of', 'makers', 'is', 'rethinking', 'the', 'way',
    'we', 'live', 'work', 'and', 'connect', 'inside', 'story', 'behind', 'quiet',
    'revolution', 'changing', 'everything', 'about', 'what', 'comes', 'next', 'why',
    'it', 'matters', 'more', 'than', 'ever', 'from', 'people', 'who', 'know',
  ],
  paragraph: [
    'the', 'a', 'of', 'and', 'to', 'in', 'that', 'was', 'for', 'with', 'over', 'time',
    'people', 'began', 'notice', 'small', 'changes', 'city', 'light', 'would', 'shift',
    'streets', 'felt', 'different', 'nobody', 'could', 'say', 'exactly', 'when', 'it',
    'started', 'but', 'everyone', 'agreed', 'something', 'had', 'moved', 'under',
    'surface', 'ordinary', 'days', 'carried', 'weight', 'quiet', 'histories', 'each',
    'morning', 'brought', 'its', 'own', 'texture', 'rhythm', 'work', 'went', 'on',
  ],
  label: [
    'new', 'featured', 'draft', 'archive', 'opinion', 'culture', 'design', 'science',
    'review', 'essay', 'report', 'update', 'notes', 'live', 'trending', 'editors',
    'pick', 'series', 'special', 'weekly',
  ],
  name: [
    'Maya Chen', 'Jonas Falk', 'Priya Anand', 'Sam Okafor', 'Lena Moreau', 'Ari Blum',
    'Nadia Reyes', 'Theo Lindqvist', 'June Park', 'Marcus Webb', 'Ines Duarte',
    'Kofi Mensah', 'Sofia Petrova', 'Owen Gallagher', 'Yuki Tanaka', 'Amara Diallo',
  ],
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const TITLE_MINOR = new Set(['a', 'an', 'the', 'of', 'and', 'to', 'in', 'for', 'with', 'on'])

function pick(rand: () => number, pool: string[]): string {
  return pool[Math.floor(rand() * pool.length)]
}

function words(rand: () => number, pool: string[], n: number): string[] {
  const out: string[] = []
  let last = ''
  for (let i = 0; i < n; i++) {
    let w = pick(rand, pool)
    let guard = 0
    while (w === last && guard++ < 8) w = pick(rand, pool)
    out.push(w)
    last = w
  }
  return out
}

function titleCase(ws: string[]): string {
  return ws
    .map((w, i) => (i === 0 || !TITLE_MINOR.has(w) ? cap(w) : w))
    .join(' ')
}

function sentence(rand: () => number, pool: string[], minWords: number, maxWords: number): string {
  const n = minWords + Math.floor(rand() * (maxWords - minWords + 1))
  const ws = words(rand, pool, n)
  return cap(ws.join(' ')) + '.'
}

function generateWords(rand: () => number, kind: GeneratorKind, count: number): string {
  switch (kind) {
    case 'title':
      return titleCase(words(rand, POOLS.title, count))
    case 'label':
      return words(rand, POOLS.label, count).map(cap).join(' ')
    case 'name': {
      // Names come as full names; count is treated as number of names.
      const n = Math.max(1, Math.round(count / 2))
      return words(rand, POOLS.name, n).join(', ')
    }
    case 'standfirst':
      return cap(words(rand, POOLS.standfirst, count).join(' ')) + '.'
    case 'paragraph':
      return cap(words(rand, POOLS.paragraph, count).join(' ')) + '.'
  }
}

function generateSentences(rand: () => number, kind: GeneratorKind, count: number): string {
  const pool = POOLS[kind === 'name' ? 'paragraph' : kind]
  const range: [number, number] =
    kind === 'title' ? [3, 6] : kind === 'label' ? [1, 2] : kind === 'standfirst' ? [10, 18] : [8, 16]
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    if (kind === 'title') parts.push(titleCase(words(rand, POOLS.title, range[0] + Math.floor(rand() * (range[1] - range[0])))))
    else parts.push(sentence(rand, pool, range[0], range[1]))
  }
  return parts.join(' ')
}

function generateCharacters(rand: () => number, kind: GeneratorKind, count: number): string {
  // Build up words until we hit the budget, trimming at a word boundary.
  let out = ''
  let guard = 0
  while (out.length < count && guard++ < 500) {
    const chunk = generateWords(rand, kind, 6)
    out = out ? out + ' ' + chunk : chunk
  }
  if (out.length <= count) return out
  const cut = out.lastIndexOf(' ', count)
  return (cut > count * 0.5 ? out.slice(0, cut) : out.slice(0, count)).replace(/[ ,.]+$/, '')
}

/**
 * Generate dummy text for a text frame. `seedOffset` lets repeater clones and
 * component instances produce different text from the same configuration.
 */
export function generateText(config: GeneratorConfig, seedOffset = 0): string {
  const rand = mulberry32(config.seed * 2654435761 + seedOffset * 40503 + 1013904223)
  const count = Math.max(1, Math.min(2000, Math.round(config.count)))
  switch (config.unit) {
    case 'words':
      return generateWords(rand, config.kind, count)
    case 'sentences':
      return generateSentences(rand, config.kind, count)
    case 'characters':
      return generateCharacters(rand, config.kind, count)
  }
}

export const GENERATOR_KINDS: { value: GeneratorKind; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'standfirst', label: 'Standfirst' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'label', label: 'Label' },
  { value: 'name', label: 'Name' },
]

export const GENERATOR_UNITS: { value: GeneratorUnit; label: string }[] = [
  { value: 'words', label: 'Words' },
  { value: 'sentences', label: 'Sentences' },
  { value: 'characters', label: 'Characters' },
]

export function defaultGeneratorFor(kind: GeneratorKind): GeneratorConfig {
  const seed = Math.floor(Math.random() * 100000)
  switch (kind) {
    case 'title':
      return { kind, unit: 'words', count: 5, seed }
    case 'standfirst':
      return { kind, unit: 'words', count: 14, seed }
    case 'paragraph':
      return { kind, unit: 'sentences', count: 3, seed }
    case 'label':
      return { kind, unit: 'words', count: 1, seed }
    case 'name':
      return { kind, unit: 'words', count: 2, seed }
  }
}
