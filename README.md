# Frameshift — connected text prototype

A small, Figma-style design tool prototype that explores **field-first content**:
text becomes structured by being *designated* a field, and only fields can be
wired to JSON data (CMS-style), driven by dummy-text generators, exposed as a
component's inputs, or cloned per-item by a repeater. The design reasoning
lives in [`docs/field-first.md`](docs/field-first.md) — this README covers
what's built.

It is not trying to match Figma's feature set — the goal is a working set of
core layout primitives (frames, text frames, optional auto layout) that make
the field-first ideas feel real.

## Running it

```bash
npm install
npm run dev        # → http://localhost:5173
```

`npm run build` produces a static build in `dist/`. The document persists to
`localStorage`; the ⟲ button in the toolbar resets to the seeded demo.

## The demo document

The canvas seeds with four top-level frames that exercise every rung of the
connection ladder:

- **Hero** — one field per state: `kicker` is a **placeholder** (marked, but
  not connected — the "FROM THE EDITORS" text you see is the whole contract),
  `title` and `tagline` are **bound** to `site.title` / `site.tagline`, and
  `standfirst` is **generator**-driven.
- **Article card** — a component definition whose four fields (`category`,
  `title`, `standfirst`, `author`) are its content API. Every field in the
  definition is a placeholder, so the card looks right with no data wired in
  at all — those placeholders are also each field's default value for
  instances that don't override it.
- **Article grid** — a repeater bound to the `articles` collection. Its first
  child is an *instance* of Article card whose fields are overridden with
  `item.*` bindings; its second child is the empty state (set `articles` to
  `[]` in the Data tab to see it).
- **Generator playground** — label / title / paragraph fields, each driven by
  a generator.

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
**Double-click a text frame to edit it in place.** That works for plain text
and for a field's **placeholder** (its own text — shown until the field is
connected). A field with a live connection is owned by that connection
instead: double-clicking it shows a toast pointing at the Content panel,
where **Disconnect** hands editing back (see below).

### Designation: field is a promotion
By default, a text frame is just text — nothing more than what it says.
**Field** is a promotion, the same grammar as frame → component, frame → auto
layout, layer → mask: an ordinary object designated as a special kind of
object with extra powers. Only fields can be connected to data or a
generator, and only fields appear in the published schema — the contract is
exactly the set of designations, nothing inferred from layer names or markup.

An unmarked text layer's inspector shows a plain **＋ Mark as content field**
button. Marking never blocks on naming: new fields get a default name
(`text_field_1`, `text_field_2`, …) — the "Frame 12" of this system — that's
an invitation to rename, not a requirement.

### The connection ladder
A field is always at one of three rungs, each subsuming the one before it:

1. **Placeholder** — unconnected. The layer's own text doubles as sample
   value and default; marking alone documents the contract.
2. **Generator** — deterministic dummy text with a kind (title / standfirst /
   paragraph / label / name), a length in words / sentences / characters, and
   a reroll (🎲) button. Repeater clones and instances vary automatically so
   repeated content doesn't look copy-pasted.
3. **Data** — bound to a path in the JSON document (Data tab), like a CMS
   field binding. Inside a collection-bound repeater, `item.*` paths resolve
   per clone. Missing paths render as a dimmed ⚠ placeholder.

Repeater frames climb the same ladder one level up, at the frame instead of
the field: **count mode** — a fixed number of clones, with no data required —
is a repeater's placeholder state; binding it to a collection is its bound
state. Two designations (field, repeater), one connection ladder.

### No-friction connecting: auto-promotion
Requiring designation before connection must not cost a click. The Content
panel's segmented control reads `[Static | Generate | Data]` on plain text;
choosing **Generate** or **Data** auto-promotes the layer to a field in the
same action — a sensible name is prefilled (the binding's last path segment,
or the generator kind) and the field block appears with the caption
*"Connecting text marks it as a content field."* Once it's a field, the
control becomes `[Placeholder | Generate | Data]`. Careful users mark first
and connect second; fast users just connect — both land in the same state.

### Names: defaults first, meaning later
Renaming a field inside a collection-bound repeater's template **is** the act
of connecting it: rename `text_field_1` to `title`, and if the bound
collection's items have a `title` key, the field snaps to `item.title` on its
own (a toast confirms it — Disconnect afterward if you meant to keep the
placeholder). Outside a bound template, a default name is just flagged as
worth renaming. The publish card lints this contract hygiene the way a
linter flags a TODO: once any field is still default-named, it shows
`N fields still have default names` in amber — a quality gate, not a block.

### Two honest ways to detach
- **Disconnect** drops the connection but keeps the field: the text last
  shown becomes the new placeholder, so the contract survives untouched.
- **Remove field** demotes the layer back to plain text, baking in what it
  showed. If the field was part of a published schema, Compare changes
  reports it as a `remove-field` migration — exactly the right weight for
  deleting part of a contract.

### Components: fields are the API
There's no separate prop machinery. Select a frame → **Create component**;
every field inside its definition IS one of that component's inputs — the
content type is exactly its fields, and the definition's own connection (or
placeholder text) is each input's default. Definitions render with purple
accents and appear in the **Components** tab, which can insert instances.

Instances override fields **by name** rather than by prop wiring: a field
without an override just falls through to the definition's own connection.
**Override** reveals a compact connection editor per field — the override can
itself be static text, a generator, or a data binding — with **Reset** back
to the default. **Detach** bakes an instance's resolved values into plain
text, leaving the component's field API untouched.

### Structure-first repeaters
Repeaters get auto layout's own two doors onto an existing frame:
- Select a frame that already wraps the thing to repeat → **Make repeater**.
- Select the thing itself → **Repeat this**, which builds the wrapper frame
  around it, inheriting the parent's flow direction and spacing.

Either door lands in **count mode with 3 clones** — the effect is visible
before any question is asked. Connecting the repeater to a data collection is
the same act as connecting a field to data, one level up: bindings inside a
collection-bound template use `item.*`. The empty state (rendered only at 0
items) is an explicit **Add empty state** button rather than a positional
convention — only the first clone is directly editable; the rest are ghosts
that select the repeater.

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
`card__title` → `title`), items missing a value get an empty string, and the
richest sibling becomes the template with its texts marked as fields bound to
`item.*` paths — the importer *proposes* the designation, it doesn't skip it.
Adjacent inline spans (`<span class="name">` + `<span class="price">`)
become separate fields. Every import is a single undo step.

### Dev Mode
Toggle with the `</> Dev Mode` pill at the right of the toolbar, or **Shift+D**
(ignored while typing or editing text on canvas). It mirrors real Figma Dev
Mode: the canvas becomes inspect-only — selection, pan, and zoom, but no
drawing tools, no drag/resize, no double-click text editing, no nudge/delete.
Field chips for every field stay visible on canvas (not just on hover),
labeled with the field's name; a **placeholder** field's chip is hollow — it's
designated, but nothing's connected — while generator/binding fields get
their usual colors. Plain text never gets a chip.

The right panel becomes the **inspect panel** in place of the Inspector:
- **Nothing selected** — a file view: publish status, drift since the last
  publish, and the full type list (see Publish schema, below).
- **A text layer** — layer name/type header, then a **Content** section
  styled like Figma's List view: Field / Intent / Constraint / Source / Path
  / Value / Description rows that **copy their value to the clipboard on
  click**. Source reads Placeholder / Generator / Data binding. Plain text
  shows a hint pointing back at Design mode instead.
- **A repeater frame** — its collection type: a fields table (captioned
  `placeholder · 3 items` in count mode, `5 items` when data-bound) plus a
  **Code** section scoped to that type.
- **A component instance** — a **Connected code** section (our **Code
  Connect** analog): real-looking JSX for the instance — bindings become
  `{path}` expressions, generators become `{generator('kind', count)}`,
  statics become string literals, an un-overridden field is simply omitted —
  captioned "via Code Connect", plus a **Fields** table of name / source /
  resolved value.
- **A component definition** — a **Fields** section captioned *"Fields inside
  this component are its content API,"* its generated TypeScript interface,
  and the same Code formats below.

Wherever a **Code** section appears, it has a `[TypeScript ▾] | JSON | Fetch`
format switcher and a copy button, backed by `model/codegen.ts`.

### Publish schema & migrations
Every designated **field** (plus component fields and collection bindings)
derives a **content schema** — types (Collection / Component / Singleton),
each with fields (name, intent, TS type, constraint). This is computed live;
nothing is written until you **Publish schema** from the Dev Mode file view.
The Types section reads e.g. `15 fields across 4 types · 11 of 13 text layers
structured` — coverage is exact, because the contract is exactly the set of
designations. (A component's fields are counted in the component type *and*
in any collection whose template is an instance of it: those are two distinct
types in the contract.)

Publishing versions the schema (`Schema v3 · published just now`) and keeps
field ids stable across renames — a field is matched to its previous version
by name, or by contributing node overlap when the name itself changed. Any
drift since the last publish shows as `N changes since v3`, expandable into a
**Compare changes** list (added/removed types and fields, renames, type
changes, constraint changes, and `remove-field` for a demoted field) — the
same migration diff Figma's "Compare changes" evokes, just for content
instead of layers. If any field is still on a default name, the publish card
also shows an amber, non-blocking lint line: `N fields still have default
names`. Republishing bumps the version and clears the drift.

## How it works

```
src/
  model/types.ts       # document model: nodes, sizing modes, fields, connections
  model/generators.ts  # seeded PRNG dummy-text generators per kind/unit
  model/resolve.ts     # path lookup, field/connection resolution, bindable-path listing
  model/schema.ts      # schema derivation, publish/migration diffing
  model/codegen.ts     # TS interfaces, sample JSON, fetch snippets, Connected code
  model/seed.ts        # the demo document
  store.ts             # zustand store: doc, selection, history, all edit actions
  editor/              # canvas, node renderer, selection overlay, interactions
  panels/              # toolbar, layers, data, components, inspector
  panels/DevPanel.tsx  # Dev Mode's inspect panel (replaces the Inspector)
  ui/                  # inspector controls + the shared ConnectionEditor
```

Nodes render to DOM, with auto layout mapped onto flexbox — so text
measurement and wrapping come from the browser. Repeater clones and instance
internals render as non-interactive "ghosts" of the template/definition with
a `RenderContext` (`item`, `index`, resolved field values, generator seed
offset) threaded through, which is what lets one node tree drive many
rendered copies. An instance only puts its *overridden* fields into
`ctx.fieldValues`; every other field resolves its own definition connection
inside the instance's context, so `item.*` bindings and generator variance
still apply to fields the instance never touched. Overlays measure the live
DOM each frame, so selection chrome tracks reflow.

## Known limitations (by design, it's a prototype)

- No reparenting by drag (children are placed by drawing inside a frame),
  no marquee selection, no multi-select resize.
- Field connections carry text only; style/visibility aren't modeled.
- Repeaters ignore children beyond the template + empty state.
- Undo history is snapshot-based and capped at 60 steps.
- Max length is an editorial constraint, not enforced — nothing stops typed
  or bound text from exceeding it.
- The published schema lives in its own `localStorage` key, versioned but
  not exported; there's no real CMS on the other end, and rename detection
  is a best-effort heuristic (name match, else contributing-node overlap).
- Dev Mode's Connected code is illustrative — it renders what Code Connect
  *would* show, not code wired to an actual component library.
- Singleton grouping (fields not inside a repeater template or component
  definition) is implicit — grouped by top-level frame, with no explicit
  "content group" designation. See the open questions in
  [`docs/field-first.md`](docs/field-first.md).
- There's no scratch/lorem mode excluded from the contract: putting a
  generator on a text always asserts fieldhood. **Remove field** is the
  escape hatch if that wasn't the intent.
