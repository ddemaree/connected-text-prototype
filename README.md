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

Most of the text in the demo is also marked up as a **content field** (see
below) — including the Hero's `FROM THE EDITORS` kicker, which is plain
static text with no binding at all, to show that fields don't require one.

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

### Content fields
Content **source** (above) and content **field** semantics are orthogonal.
Any text frame's inspector has a **Content field** block, separate from
Content: an empty state (`＋ Mark as content field`) or, once marked, a
**Name**, an **Intent** (Title / Standfirst / Paragraph / Label / Name /
Custom — the same vocabulary as generator kinds), a **Description** for
developers/editors, and an optional **max length** (a count + words /
sentences / characters, same as a generator's length).

Marking a text prefills sensibly: the name comes from its binding's last path
segment (`item.title` → `title`), its prop name, or a slugified layer name;
intent and max length copy a generator's kind/length if the text is
generator-driven, otherwise intent defaults to Custom and there's no
constraint. Everything after that is yours to edit — the field record is
independent of where the text's content actually comes from.

That's the point: a **static** text with field markup contributes to the
schema exactly like a bound one — no CMS connection required to describe
what a piece of content *is*. The inspector flags this with a hint line
("Static text with field markup — included in the published schema.") so
it's clear the text is doing double duty.

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

### Dev Mode
Toggle with the `</> Dev Mode` pill at the right of the toolbar, or **Shift+D**
(ignored while typing or editing text on canvas). It mirrors real Figma Dev
Mode: the canvas becomes inspect-only — selection, pan, and zoom, but no
drawing tools, no drag/resize, no double-click text editing, no nudge/delete.
Connection chips for every field/connected text stay visible on canvas
(not just on hover), and static text carrying field markup gets a distinct
hollow chip so "markup on static text" reads as its own state.

The right panel becomes the **inspect panel** in place of the Inspector:
- **Nothing selected** — a file view: publish status, drift since the last
  publish, and the full type list (see Publish schema, below).
- **A text layer** — layer name/type header, then a **Content** section
  styled like Figma's List view: Field / Intent / Constraint / Source / Path
  / Value / Description rows that **copy their value to the clipboard on
  click**. Unstructured static text shows a hint pointing back at Design mode
  instead.
- **A repeater frame** — its collection type: a fields table plus a **Code**
  section scoped to that type.
- **A component instance** — a **Connected code** section (our **Code
  Connect** analog): real-looking JSX for the instance — bindings become
  `{path}` expressions, generators become `{generator('kind', count)}`,
  statics become string literals — captioned "via Code Connect", plus a
  props table.
- **A component definition** — its generated TypeScript interface and a
  props table.

Wherever a **Code** section appears, it has a `[TypeScript ▾] | JSON | Fetch`
format switcher and a copy button, backed by `model/codegen.ts`.

### Publish schema & migrations
Every text's content **field** metadata (plus component props and collection
bindings) derives a **content schema** — types (Collection / Component /
Singleton), each with fields (name, intent, TS type, constraint). This is
computed live; nothing is written until you **Publish schema** from the Dev
Mode file view.

Publishing versions the schema (`Schema v3 · published just now`) and keeps
field ids stable across renames — a field is matched to its previous version
by name, or by contributing node overlap when the name itself changed. Any
drift since the last publish shows as `N changes since v3`, expandable into a
**Compare changes** list (added/removed types and fields, renames, type
changes, constraint changes) — the same migration diff Figma's "Compare
changes" evokes, just for content instead of layers. Republishing bumps the
version and clears the drift.

## How it works

```
src/
  model/types.ts       # document model: nodes, sizing modes, content sources, field meta
  model/generators.ts  # seeded PRNG dummy-text generators per kind/unit
  model/resolve.ts     # path lookup, content resolution, bindable-path listing
  model/schema.ts      # schema derivation, publish/migration diffing
  model/codegen.ts     # TS interfaces, sample JSON, fetch snippets, Connected code
  model/seed.ts        # the demo document
  store.ts             # zustand store: doc, selection, history, all edit actions
  editor/              # canvas, node renderer, selection overlay, interactions
  panels/              # toolbar, layers, data, components, inspector
  panels/DevPanel.tsx  # Dev Mode's inspect panel (replaces the Inspector)
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
- Max length is an editorial constraint, not enforced — nothing stops typed
  or bound text from exceeding it.
- The published schema lives in its own `localStorage` key, versioned but
  not exported; there's no real CMS on the other end, and rename detection
  is a best-effort heuristic (name match, else contributing-node overlap).
- Dev Mode's Connected code is illustrative — it renders what Code Connect
  *would* show, not code wired to an actual component library.
