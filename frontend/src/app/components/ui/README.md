# UI system

Shared primitives for EAF Schedulr. Everything here was extracted from
`App.tsx` because the same markup was already written three or more times — not
because it might be reusable one day. If a pattern appears once, it stays a
utility class at the call site.

## Tokens

Defined in [`../../styles/theme.css`](../../../styles/theme.css) and exposed as
Tailwind utilities through `@theme inline`. Use these instead of writing a
`light dark:` colour pair by hand; that pair is exactly the thing that drifts.

### Text, strongest to faintest

| Utility | Light | Dark | Use for |
|---|---|---|---|
| `text-strong-foreground` | `gray-950` | `gray-100` | Course names — content that must win |
| `text-foreground` | `gray-900` | `gray-100` | Headings, field values, inherited body text |
| `text-label-foreground` | `gray-700` | `gray-300` | Form labels |
| `text-muted-foreground` | `gray-600` | `gray-400` | Supporting copy, hints |
| `text-subtle-foreground` | `gray-500` | `gray-400` | Metadata, captions, placeholders — the AA floor |

There is no sixth, quieter tier. `gray-400` measures 2.53:1 on the light card and
`gray-500` measures 3.41:1 on the dark one, so anything below `subtle` fails AA in
one theme or the other. If something needs to recede further, reduce its size or
weight — not its contrast.

### Surfaces

| Utility | Light | Dark | Use for |
|---|---|---|---|
| `bg-card` | `white/60` | `slate-800/60` | The frosted panel — prefer `<GlassCard>` |
| `border-card-border` | `white/50` | `emerald-500/20` | That panel's edge |
| `bg-card-inset` | `white/70` | `slate-700/50` | Fields and controls sitting on a panel |
| `border-card-inset-border` | `gray-200/50` | `slate-600/50` | Those controls' edges |
| `bg-card-well` | `white/70` | `slate-900/30` | A recessed well inside an alert |

Brand, ring and destructive tokens exist too, but the emerald/teal gradients are
still written at their call sites: each one is a different pair of stops, so a
token would only rename the problem. `IconTile` collects them instead.

## Components

### `<GlassCard>`

The translucent panel the page is built from. Forwards refs — two instances are
scroll targets.

```tsx
<GlassCard className="mb-12 p-6 sm:p-8">…</GlassCard>
<GlassCard shadow="2xl" className="p-8">…</GlassCard>   // hero workflow card
```

### `<Field>`

A labelled input with its hint and error. The accessible wiring is the reason it
exists: `aria-invalid`, and an `aria-describedby` pointing at whichever of the
hint or error is actually rendered. Never hand-roll an input.

```tsx
<Field
  id="num-weeks"
  type="number"
  label="Number of weeks"
  required
  value={numWeeks}
  onChange={setNumWeeks}
  min={1}
  max={52}
  hint="A DLSU term is usually 14 weeks."
  error={validationErrors.numWeeks}
/>
```

### `<Alert>`

A titled, icon-led message block. `role="alert"` lives inside the component so a
new alert cannot ship silently to screen readers.

- `tone="danger"` — the student cannot continue on this path.
- `tone="warning"` — they can continue once they have understood something.
- `variant="panel"` (default) is the full-width card; `variant="inline"` is the
  lighter banner that sits inside the form.

```tsx
<Alert tone="danger" title="Can't reach the server" message={error.message}>
  <button>Try again</button>
</Alert>
```

### `<IconTile>`

The gradient-filled rounded square holding a single icon. Five tones — three brand
(`brand`, `emerald`, `teal`) and two semantic (`danger`, `warning`) — three
sizes, and depth chosen separately from size.

Every gradient in the product lives in this file's `TONES` map. There is no
general-purpose "accent" tone on purpose: that is what previously let a blue card
and a purple card into an emerald product. Separate neighbouring surfaces with
`emerald` against `teal` instead.

```tsx
<IconTile tone="warning"><AlertCircle className="h-6 w-6" /></IconTile>
<IconTile tone="teal" size="lg" className="relative"><CalendarDays /></IconTile>
```

### `<AmbiguousRowList>`

The rows the parser could not read, grouped by course. Rendered in amber when
the rest of the EAF parsed, in rose when nothing did. Two call sites rather than
the usual three — extracted anyway because the two are identical but for the hue
and are guaranteed to stay in lockstep.

## Known drift

These pairs are still written by hand because each appears only once or twice.
They look like unintentional variation on the tiers above and are candidates for
normalisation during a colour pass — not silently, since changing them changes
pixels:

- `text-gray-700 dark:text-gray-200` (2) · `text-gray-800 dark:text-gray-100` (1)
- `text-gray-600 dark:text-gray-300` (1) · `text-gray-300 dark:text-gray-600` (1)
- `bg-white/80 dark:bg-slate-700/60` (2) — the secondary button
