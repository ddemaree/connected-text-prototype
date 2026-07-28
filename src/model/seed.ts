import {
  DEFAULT_TEXT_STYLE,
  type AnyNode,
  type ContentSource,
  type DesignDoc,
  type FrameNode,
  type InstanceNode,
  type TextNode,
  type TextStyle,
} from './types'

export const SEED_DATA = {
  site: {
    title: 'The Sunday Long Read',
    tagline: 'Slow journalism for fast times',
  },
  articles: [
    {
      title: 'The Quiet Rise of Urban Beekeeping',
      standfirst: 'How rooftop hives are reshaping city ecosystems, one block at a time.',
      author: 'Maya Chen',
      category: 'Environment',
      readTime: '8 min read',
    },
    {
      title: 'What We Lost When Offices Emptied',
      standfirst: 'Three years on, the geography of work is still looking for its center.',
      author: 'Jonas Falk',
      category: 'Work',
      readTime: '12 min read',
    },
    {
      title: 'A Field Guide to Slow Software',
      standfirst: 'The tools that respect your attention — and the people who make them.',
      author: 'Priya Anand',
      category: 'Technology',
      readTime: '6 min read',
    },
    {
      title: 'The Cartographers of Memory',
      standfirst: 'Inside the volunteer project mapping neighborhoods that no longer exist.',
      author: 'Sam Okafor',
      category: 'Culture',
      readTime: '15 min read',
    },
    {
      title: 'Night Trains Are Back. Can They Stay?',
      standfirst: 'Europe rediscovered the sleeper car. Now comes the hard part.',
      author: 'Lena Moreau',
      category: 'Travel',
      readTime: '9 min read',
    },
  ],
}

function text(
  id: string,
  parentId: string | null,
  name: string,
  content: ContentSource,
  style: Partial<TextStyle> = {},
  layout: Partial<Pick<TextNode, 'x' | 'y' | 'width' | 'height' | 'widthMode' | 'heightMode'>> = {},
): TextNode {
  return {
    id,
    type: 'text',
    name,
    parentId,
    x: layout.x ?? 0,
    y: layout.y ?? 0,
    width: layout.width ?? 200,
    height: layout.height ?? 24,
    widthMode: layout.widthMode ?? 'fill',
    heightMode: layout.heightMode ?? 'hug',
    style: { ...DEFAULT_TEXT_STYLE, ...style },
    content,
  }
}

function frame(
  id: string,
  parentId: string | null,
  name: string,
  partial: Partial<FrameNode> = {},
): FrameNode {
  return {
    id,
    type: 'frame',
    name,
    parentId,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    widthMode: 'fixed',
    heightMode: 'hug',
    children: [],
    fill: null,
    stroke: null,
    strokeWidth: 1,
    cornerRadius: 0,
    shadow: false,
    clip: false,
    autoLayout: null,
    ...partial,
  }
}

export function buildSeedDoc(): DesignDoc {
  const nodes: Record<string, AnyNode> = {}
  const add = (n: AnyNode) => {
    nodes[n.id] = n
    return n
  }

  // ---- Hero frame: bindings to site data + a generator standfirst ----
  add(
    frame('hero', null, 'Hero', {
      x: 80,
      y: 60,
      width: 560,
      widthMode: 'fixed',
      heightMode: 'hug',
      fill: '#ffffff',
      cornerRadius: 16,
      shadow: true,
      autoLayout: { direction: 'column', gap: 10, paddingX: 40, paddingY: 40, align: 'start', justify: 'start', wrap: false },
      children: ['hero-kicker', 'hero-title', 'hero-tagline', 'hero-standfirst'],
    }),
  )
  add(
    text('hero-kicker', 'hero', 'Kicker', { type: 'static', value: 'This week' }, {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 1.2,
      uppercase: true,
      color: '#b04618',
    }),
  )
  add(
    text('hero-title', 'hero', 'Site title', { type: 'binding', path: 'site.title' }, {
      fontFamily: 'serif',
      fontSize: 40,
      fontWeight: 700,
      lineHeight: 1.1,
      color: '#141414',
    }),
  )
  add(
    text('hero-tagline', 'hero', 'Tagline', { type: 'binding', path: 'site.tagline' }, {
      fontSize: 17,
      fontWeight: 500,
      color: '#6b6b6b',
    }),
  )
  add(
    text(
      'hero-standfirst',
      'hero',
      'Generated standfirst',
      { type: 'generator', config: { kind: 'standfirst', unit: 'words', count: 18, seed: 42 } },
      { fontSize: 15, color: '#3d3d3d', lineHeight: 1.5 },
    ),
  )

  // ---- Article card component ----
  add(
    frame('card', null, 'Article card', {
      x: 80,
      y: 430,
      width: 300,
      widthMode: 'fixed',
      heightMode: 'hug',
      fill: '#ffffff',
      cornerRadius: 12,
      shadow: true,
      autoLayout: { direction: 'column', gap: 8, paddingX: 24, paddingY: 24, align: 'start', justify: 'start', wrap: false },
      children: ['card-category', 'card-title', 'card-standfirst', 'card-byline'],
      isComponent: true,
      props: [
        { name: 'category', defaultValue: 'Category' },
        { name: 'title', defaultValue: 'Article title goes here' },
        { name: 'standfirst', defaultValue: 'A short standfirst that sets up the story in a sentence.' },
        { name: 'author', defaultValue: 'Author Name' },
      ],
    }),
  )
  add(
    text('card-category', 'card', 'Category', { type: 'prop', prop: 'category' }, {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1,
      uppercase: true,
      color: '#b04618',
    }),
  )
  add(
    text('card-title', 'card', 'Title', { type: 'prop', prop: 'title' }, {
      fontFamily: 'serif',
      fontSize: 20,
      fontWeight: 700,
      lineHeight: 1.25,
      color: '#141414',
    }),
  )
  add(
    text('card-standfirst', 'card', 'Standfirst', { type: 'prop', prop: 'standfirst' }, {
      fontSize: 13.5,
      color: '#5c5c5c',
      lineHeight: 1.5,
    }),
  )
  add(
    text('card-byline', 'card', 'Byline', { type: 'prop', prop: 'author' }, {
      fontSize: 12,
      fontWeight: 600,
      color: '#8a8a8a',
    }),
  )

  // ---- Repeater grid bound to the articles collection ----
  add(
    frame('grid', null, 'Article grid', {
      x: 700,
      y: 60,
      width: 660,
      widthMode: 'fixed',
      heightMode: 'hug',
      fill: '#f2efe9',
      cornerRadius: 16,
      autoLayout: { direction: 'row', gap: 16, paddingX: 20, paddingY: 20, align: 'start', justify: 'start', wrap: true },
      children: ['grid-item', 'grid-empty'],
      repeat: { mode: 'collection', path: 'articles' },
    }),
  )
  const gridItem: InstanceNode = {
    id: 'grid-item',
    type: 'instance',
    name: 'Article card',
    parentId: 'grid',
    x: 0,
    y: 0,
    width: 296,
    height: 200,
    widthMode: 'fixed',
    heightMode: 'hug',
    componentId: 'card',
    overrides: {
      category: { type: 'binding', path: 'item.category' },
      title: { type: 'binding', path: 'item.title' },
      standfirst: { type: 'binding', path: 'item.standfirst' },
      author: { type: 'binding', path: 'item.author' },
    },
  }
  add(gridItem)
  add(
    frame('grid-empty', 'grid', 'Empty state', {
      widthMode: 'fill',
      heightMode: 'hug',
      fill: '#ffffff',
      cornerRadius: 12,
      stroke: '#d8d2c6',
      autoLayout: { direction: 'column', gap: 6, paddingX: 32, paddingY: 48, align: 'center', justify: 'center', wrap: false },
      children: ['grid-empty-title', 'grid-empty-sub'],
    }),
  )
  add(
    text(
      'grid-empty-title',
      'grid-empty',
      'Empty title',
      { type: 'static', value: 'No articles yet' },
      { fontSize: 16, fontWeight: 700, color: '#4a4a4a', textAlign: 'center' },
      { widthMode: 'hug' },
    ),
  )
  add(
    text(
      'grid-empty-sub',
      'grid-empty',
      'Empty subtitle',
      { type: 'static', value: 'Published stories will appear here automatically.' },
      { fontSize: 13, color: '#8a8a8a', textAlign: 'center' },
      { widthMode: 'hug' },
    ),
  )

  // ---- Generator playground ----
  add(
    frame('playground', null, 'Generator playground', {
      x: 80,
      y: 750,
      width: 480,
      widthMode: 'fixed',
      heightMode: 'hug',
      fill: '#ffffff',
      cornerRadius: 16,
      shadow: true,
      autoLayout: { direction: 'column', gap: 14, paddingX: 32, paddingY: 32, align: 'start', justify: 'start', wrap: false },
      children: ['pg-label', 'pg-title', 'pg-para'],
    }),
  )
  add(
    text('pg-label', 'playground', 'Generated label', {
      type: 'generator',
      config: { kind: 'label', unit: 'words', count: 2, seed: 7 },
    }, { fontSize: 11, fontWeight: 700, letterSpacing: 1.1, uppercase: true, color: '#2f6f4f' }),
  )
  add(
    text('pg-title', 'playground', 'Generated title', {
      type: 'generator',
      config: { kind: 'title', unit: 'words', count: 6, seed: 11 },
    }, { fontFamily: 'serif', fontSize: 28, fontWeight: 700, lineHeight: 1.2, color: '#141414' }),
  )
  add(
    text('pg-para', 'playground', 'Generated paragraph', {
      type: 'generator',
      config: { kind: 'paragraph', unit: 'sentences', count: 3, seed: 23 },
    }, { fontSize: 14, color: '#3d3d3d', lineHeight: 1.6 }),
  )

  return {
    nodes,
    rootIds: ['hero', 'card', 'grid', 'playground'],
    data: structuredClone(SEED_DATA),
  }
}
