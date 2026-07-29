import {
  DEFAULT_TEXT_STYLE,
  type AnyNode,
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
  content: string,
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
    text: content,
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

  // ---- Hero frame: one field per rung of the connection ladder ----
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
  add({
    // Placeholder: marking alone documents the contract, no connection needed.
    ...text('hero-kicker', 'hero', 'Kicker', 'FROM THE EDITORS', {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 1.2,
      uppercase: true,
      color: '#b04618',
    }),
    field: {
      name: 'kicker',
      intent: 'label',
      maxLength: { unit: 'characters', count: 24 },
      description: 'Short section label above the hero title.',
      connection: { type: 'none' },
    },
  })
  add({
    ...text('hero-title', 'hero', 'Site title', 'The Sunday Long Read', {
      fontFamily: 'serif',
      fontSize: 40,
      fontWeight: 700,
      lineHeight: 1.1,
      color: '#141414',
    }),
    field: { name: 'title', intent: 'title', connection: { type: 'binding', path: 'site.title' } },
  })
  add({
    ...text('hero-tagline', 'hero', 'Tagline', 'Slow journalism for fast times', {
      fontSize: 17,
      fontWeight: 500,
      color: '#6b6b6b',
    }),
    field: {
      name: 'tagline',
      intent: 'standfirst',
      maxLength: { unit: 'words', count: 12 },
      connection: { type: 'binding', path: 'site.tagline' },
    },
  })
  add({
    ...text(
      'hero-standfirst',
      'hero',
      'Generated standfirst',
      'A standfirst that sets up the story below.',
      { fontSize: 15, color: '#3d3d3d', lineHeight: 1.5 },
    ),
    field: {
      name: 'standfirst',
      intent: 'standfirst',
      connection: { type: 'generator', config: { kind: 'standfirst', unit: 'words', count: 18, seed: 42 } },
    },
  })

  // ---- Article card component: its fields are its API, its text the defaults ----
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
    }),
  )
  add({
    ...text('card-category', 'card', 'Category', 'Category', {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1,
      uppercase: true,
      color: '#b04618',
    }),
    field: { name: 'category', intent: 'label', connection: { type: 'none' } },
  })
  add({
    ...text('card-title', 'card', 'Title', 'Article title goes here', {
      fontFamily: 'serif',
      fontSize: 20,
      fontWeight: 700,
      lineHeight: 1.25,
      color: '#141414',
    }),
    field: {
      name: 'title',
      intent: 'title',
      maxLength: { unit: 'words', count: 12 },
      connection: { type: 'none' },
    },
  })
  add({
    ...text('card-standfirst', 'card', 'Standfirst', 'A short standfirst that sets up the story in a sentence.', {
      fontSize: 13.5,
      color: '#5c5c5c',
      lineHeight: 1.5,
    }),
    field: {
      name: 'standfirst',
      intent: 'standfirst',
      maxLength: { unit: 'words', count: 24 },
      connection: { type: 'none' },
    },
  })
  add({
    ...text('card-byline', 'card', 'Byline', 'Author Name', {
      fontSize: 12,
      fontWeight: 600,
      color: '#8a8a8a',
    }),
    field: { name: 'author', intent: 'name', connection: { type: 'none' } },
  })

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
      children: ['grid-card', 'grid-empty'],
      repeat: { mode: 'collection', path: 'articles' },
    }),
  )
  add(
    frame('grid-card', 'grid', 'Card', {
      width: 296,
      widthMode: 'fixed',
      heightMode: 'hug',
      autoLayout: { direction: 'column', gap: 6, paddingX: 0, paddingY: 0, align: 'start', justify: 'start', wrap: false },
      children: ['grid-item', 'grid-readtime'],
    }),
  )
  const gridItem: InstanceNode = {
    id: 'grid-item',
    type: 'instance',
    name: 'Article card',
    parentId: 'grid-card',
    x: 0,
    y: 0,
    width: 296,
    height: 200,
    widthMode: 'fill',
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
    // Plain on purpose: mark it, rename it to a data key (readTime), and
    // name-snap connects it — the live demo of naming-as-mapping.
    text('grid-readtime', 'grid-card', 'Read time', '8 min read', {
      fontSize: 11,
      fontWeight: 600,
      color: '#8a8a8a',
    }),
  )
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
      'No articles yet',
      { fontSize: 16, fontWeight: 700, color: '#4a4a4a', textAlign: 'center' },
      { widthMode: 'hug' },
    ),
  )
  add(
    text(
      'grid-empty-sub',
      'grid-empty',
      'Empty subtitle',
      'Published stories will appear here automatically.',
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
  add({
    ...text('pg-label', 'playground', 'Generated label', 'Section label', {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1.1,
      uppercase: true,
      color: '#2f6f4f',
    }),
    field: {
      name: 'label',
      intent: 'label',
      connection: { type: 'generator', config: { kind: 'label', unit: 'words', count: 2, seed: 7 } },
    },
  })
  add({
    ...text('pg-title', 'playground', 'Generated title', 'A title of about six words', {
      fontFamily: 'serif',
      fontSize: 28,
      fontWeight: 700,
      lineHeight: 1.2,
      color: '#141414',
    }),
    field: {
      name: 'title',
      intent: 'title',
      connection: { type: 'generator', config: { kind: 'title', unit: 'words', count: 6, seed: 11 } },
    },
  })
  add({
    ...text('pg-para', 'playground', 'Generated paragraph', 'Three sentences of body copy live here.', {
      fontSize: 14,
      color: '#3d3d3d',
      lineHeight: 1.6,
    }),
    field: {
      name: 'paragraph',
      intent: 'paragraph',
      connection: { type: 'generator', config: { kind: 'paragraph', unit: 'sentences', count: 3, seed: 23 } },
    },
  })

  return {
    nodes,
    rootIds: ['hero', 'card', 'grid', 'playground'],
    data: structuredClone(SEED_DATA),
  }
}
