# Field-first: structured content as a layer designation

This document describes the second iteration of Frameshift's content model —
the "field-first" design — and the reasoning behind it.

## The problem with annotation-on-the-side

The first iteration treated a text layer's **content source** (static /
data binding / generator / component prop) and its **field markup** (name,
intent, constraints) as two independent, optional properties. That bought a
useful state — static text with field markup contributes to the schema with
no binding — but it also created four awkward ones: text that is *connected
but anonymous*. The schema deriver had to invent names for those layers
(binding path leaves, slugified layer names), which meant the quality of the
published contract depended on annotation discipline, and the deriver
silently made things up when discipline slipped.

## The inversion

By default, text is just text. **Field** is a promotion — the same grammar
as frame → component, frame → auto layout, layer → mask, frame → repeater:
an ordinary object that can be designated as a special kind of object with
extra powers. Only fields can be connected to data or generators.

The consequence that matters: **the content contract is exactly the set of
designations.** Nothing is inferred, nothing is invented, nothing is missed.
Schema derivation stops being a heuristic walk and becomes a serialization
of intent. Coverage ("11 of 13 text layers structured") becomes exact.

## No-friction rule: connecting is marking

Requiring designation before binding must not add clicks. Applying a
generator or a data binding to a plain text **auto-promotes** it to a field
in the same action, with a sensible name prefilled (the binding's last path
segment, or the generator kind). Careful users mark first and connect
second; fast users just connect. Both land in the same state.

## One connection spectrum

A field is always in one of three states, each subsuming the value of the
one before it:

1. **Placeholder** — unconnected. The layer's own text doubles as sample
   value and default. Marking alone documents the contract.
2. **Generator** — the constraint made executable. Intent and length aren't
   just documented, they're demonstrated on canvas; reroll is property
   testing for the layout.
3. **Bound** — the mapping expressed. The field documents *and* implements
   its connection to the data source.

Repeaters run on the same spectrum at the frame level. A repeater maps a
frame to a *collection* the way a field maps a text to a *value*:
**count mode is the repeater's generator** — dummy cardinality with implicit
rules — and collection binding is its bound state. Two designations (field,
repeater), one connection ladder, and the whole model composes from there.

## Structure-first repeaters

Auto layout is the UX precedent: you can apply it to an existing frame, or
select objects and have it wrap them. Repeaters get the same two doors:

- Select a frame that already wraps the thing to repeat → **Make repeater**.
- Select the thing itself → **Repeat this**, which creates the wrapper
  around it, inheriting flow direction and spacing.

Promotion defaults to **count mode with 3 clones** so the effect is
instantly visible — no question asked before a result is shown. The empty
state becomes an explicit **Add empty state** affordance instead of a
positional convention.

## Names: defaults first, meaning later

Marking a field never blocks on naming. Default names (`text_field_1`,
`text_field_2`, …) are the "Frame 12" of this system. Two consequences:

- **Name-as-mapping.** Inside a collection-bound repeater template, a field
  named `title` defaults its binding to `item.title` — renaming a field to
  match the data *is* the act of connecting it. A default name is visibly
  unmapped; a meaningful name snaps into place. Convention at design time
  matches how CMS codegen works at production time (field key = property
  name), so the two agree by construction.
- **Contract hygiene is measurable.** The publish card can lint "3 fields
  still have default names" the way linters flag TODOs — a quality gate
  before schema publish.

## Components: fields are the API

The separate prop machinery disappears. A field inside a component
definition *is* one of that component's inputs: the component's content
type is exactly its fields, the definition's own connection (or placeholder
text) is the default value, and instance overrides are per-field connection
states (static value, generator, or binding). This deletes the `prop`
content-source kind, the Expose action, and the prop/field enrichment pass
in the schema deriver.

## Two honest detach operations

- **Disconnect** — drop the connection, keep the field. The last shown text
  becomes the placeholder; the contract survives.
- **Remove field** — demote to plain text. If the field is in a published
  schema, Compare changes reports it as a `remove-field` migration, which
  is exactly the right weight for deleting part of a contract.

## Inference proposes, designation disposes

The HTML importer keeps its role as the brownfield on-ramp — detecting
repeated structures, extracting collections, naming fields from markup —
but its output is now *proposed designations*: imported templates arrive as
marked fields bound to `item.*`. The contract remains an intentional act;
inference only drafts it.

## Open questions

- **Singleton grouping** is implicit (fields grouped by their top-level
  frame). An explicit third designation ("content group") might eventually
  be right; not adding it without pressure.
- **Throwaway dummy text.** Under this model, putting a generator on a text
  asserts fieldhood. That's the thesis (if you need generated text, you're
  designing for content you don't have yet), and Remove field is the escape
  hatch — but a scratch/lorem mode excluded from the contract remains a
  possible future concession.

## Design principle

Every designation works instantly with defaults, and every default is an
invitation to refine: promote a field with no name, promote a repeater with
no data, and meaning accretes as you name and bind.
