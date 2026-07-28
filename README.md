# Frameshift — connected text prototype

A small, Figma-style design tool prototype that explores how **text frames can be
connected to content**: bound to JSON data (CMS-style), driven by dummy-text
generators, wired to component props, and cloned by data-driven repeater frames.

It is not trying to match Figma's feature set — the goal is a working set of core
layout primitives (frames, text frames, optional auto layout) that make the
connected-content ideas feel real.

## Running it

```bash
npm install
npm run dev        # → http://localhost:5173
```

`npm run build` produces a static build in `dist/`. The document persists to
`localStorage`; the ⟲ button in the toolbar resets to the seeded demo.

## The demo document

The canvas seeds with four top-level frames that exercise everything:

- **Hero** — text frames bound to `site.title` / `site.tagline`, plus a
  generator-driven standfirst.
- **Article card** — a component definition with `category` / `title` /
  `standfirst` / `author` props; the text frames inside are bound to those props.
- **Article grid** — a repeater frame bound to the `articles` collection. Its
  first child is an *instance* of Article card whose props are bound to
  `item.*` paths; its second child is the empty state (set `articles` to `[]`
  in the Data tab to see it).
- **Generator playground** — label / title / paragraph generators.

## Feature tour

### Layout primitives
- **Frames** (`F`, drag to draw — drawing inside a frame nests it) and
  **text frames** (`T`, click or drag). Frames have fill, stroke, radius,
  shadow, clip. With the frame tool active, the inspector offers **size
  presets** (Desktop 1200×960, Web, Tablet, Phone, Card, Square) that place
  a frame centered in the viewport.
- **Auto layout** (`Shift+A` or the inspector): direction, gap, padding,
  alignment, distribution, and wrap. Children can size **Fixed / Hug / Fill**
  per axis. Dragging a child of an auto-layout frame reorders it; removing
  auto layout bakes the current positions back to absolute coordinates.
- Select/move/resize with overlays, `⌘/Ctrl+Z` undo, `⌘/Ctrl+D` duplicate,
  arrow-key nudging, zoom (`⌘/Ctrl+scroll`), pan (space+drag / middle mouse).

### Editing text
**Double-click a text frame to edit it in place.** If the text is *connected*
(bound, generated, or prop-driven) a toast points you at the Content panel
instead of silently overwriting the connection — a **Detach** button there
converts connected text back to editable static text, keeping what's
currently shown.

### Connected text
Every text frame has a **Content source**, shown as a chip on the canvas and a
colored dot in the Layers panel:

- **Static** — hand-typed text.
- **Data** — a path into the JSON document in the **Data** tab
  (e.g. `articles[0].title`), like a CMS field binding. Inside a
  collection-bound repeater, `item.*` paths resolve per clone. Missing paths
  render as a dimmed ⚠ placeholder.
- **Generate** — deterministic dummy text with a **kind**
  (title / standfirst / paragraph / label / name) that doubles as a statement
  of the field's intended purpose, a **length** in words / sentences /
  characters, and a reroll (🎲) button. Repeater clones and instances vary
  automatically so repeated content doesn't look copy-pasted.
- **Prop** — inside a component definition, reads a component prop.

### Components
- Select a frame → **Create component**. Definitions render with purple
  accents and appear in the **Components** tab, which can insert instances.
- Select a text frame inside a definition and **Expose** it to create a prop
  (current text becomes the default) and bind the text to it.
- Instances override props per instance — and each prop value is itself a
  content source, so an instance prop can be **static text, a data binding, or
  a generator**. Reset any override to the component default, or **Detach** to
  bake the current values into plain frames.

### Repeater frames
Any frame can become a repeater (inspector → Repeater):

- **Count** — clones its first child N times (a for-loop for the canvas).
- **Data** — clones once per item of a JSON collection; bindings inside the
  template use `item.*`.
- The **second child is the empty state**, rendered only when there are 0
  items — so empty, short, and long collections are all designed in one place.
- Combined with auto-layout wrap + Fill sizing, odd item counts are handled by
  layout instead of manual duplication. Only the first clone is directly
  editable; the rest are ghosts that select the repeater.

### HTML import (code → design)
Paste HTML anywhere on the canvas — or use the `</>` toolbar button for a
paste-in dialog with a bundled example. Blocks become auto-layout frames,
headings and paragraphs become styled text (inline `style=""` attributes are
best-effort parsed; stylesheets are ignored — it's deliberately lossy), images
and buttons get placeholder treatment. A few Tailwind layout utilities
(`flex`, `flex-col`, `grid`, `gap-*`, `p-*`) are honored as auto-layout
hints. The interesting part: when a container's children repeat — same tag
and class (structural variance allowed: optional excerpts, missing images),
or identical structure for classless markup — the importer converts it into
a **collection-bound repeater**. The content is extracted into a JSON
collection in the Data panel (field names from class names, BEM-aware:
`card__title` → `title`), items missing a field get an empty string, and the
richest sibling becomes the template with its text bound to `item.*` paths.
Adjacent inline spans (`<span class="name">` + `<span class="price">`)
become separate fields. Every import is a single undo step.

### Figma paste (design → design)
Copy layers in Figma — or capture a webpage with Figma's Chrome extension —
and paste anywhere on the canvas (or into the `</>` import dialog). Figma
puts the whole scene fragment on the clipboard as a base64 blob inside the
`text/html` flavor (`<!--(figma)…(/figma)-->`); the importer decodes it
in-browser with no dependencies: the `fig-kiwi` container is unpacked, its
chunks inflated with the native `DecompressionStream`, and the
[Kiwi](https://github.com/evanw/kiwi)-encoded scene decoded against the
schema that ships inside the payload (so it tracks Figma's schema changes).

Frames, groups and shapes become frames (fills, strokes, corner radius);
Figma auto layout maps onto ours (direction, gap, padding, alignment,
hug/fill sizing); text keeps its size, weight, color, alignment, line
height, letter spacing and casing. Component instances are resolved through
their symbol with per-instance text overrides applied. The same
repeated-sibling detection as HTML import then runs on the pasted tree —
three or more alike cards collapse into a **collection-bound repeater**,
with field names taken from Figma layer names ("Title", "Author" →
`item.title`, `item.author`; auto-named text layers fall back to generic
names). Cards that were hand-placed without auto layout still collapse when
their geometry reads as a row, column or uniform grid — the layout is
inferred first, then the repeat extracted. Vector contents, images and
effects get placeholder treatment; rotation is ignored.

## How it works

```
src/
  model/types.ts       # document model: nodes, sizing modes, content sources
  model/importIr.ts    # shared import IR + repeated-sibling detection
  model/htmlImport.ts  # HTML → IR
  model/figmaImport.ts # Figma clipboard (fig-kiwi + Kiwi decoding) → IR
  model/generators.ts  # seeded PRNG dummy-text generators per kind/unit
  model/resolve.ts     # path lookup, content resolution, bindable-path listing
  model/seed.ts        # the demo document
  store.ts             # zustand store: doc, selection, history, all edit actions
  editor/              # canvas, node renderer, selection overlay, interactions
  panels/              # toolbar, layers, data, components, inspector
  ui/                  # inspector controls + the shared ContentSource editor
```

Nodes render to DOM, with auto layout mapped onto flexbox — so text
measurement and wrapping come from the browser. Repeater clones and instance
internals render as non-interactive "ghosts" of the template/definition with a
`RenderContext` (`item`, `index`, resolved prop values, generator seed offset)
threaded through, which is what lets one node tree drive many rendered copies.
Overlays measure the live DOM each frame, so selection chrome tracks reflow.

## Known limitations (by design, it's a prototype)

- No reparenting by drag (children are placed by drawing inside a frame),
  no marquee selection, no multi-select resize.
- Prop bindings carry text only; style/visibility props aren't modeled.
- Repeaters ignore children beyond the template + empty state.
- Undo history is snapshot-based and capped at 60 steps.
