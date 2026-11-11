# Design direction

Rowsetta is a tool for people who have a table and need its labels to be right.
The look comes from that: a proofreader's marked-up sheet. Rows are ruled
lines, labels are stamps, and the one loud colour is the highlighter that goes
over a row when something needs a second look.

## Audience action

An analyst opens a CSV, labels a few rows, and keeps a rule. Before that, they
need to trust the labels they already have. The first thing the interface
proves is that it can find the wrong ones.

## Signature moment: the marker pass

Press "Check these". The audit runs, and then the table is read the way a
proofreader reads a page. In rank order, the table scrolls to each suspect row
that is on the page and one marker stroke is dragged across it from the left.
Its edge is ragged, and each later stroke is thinner and paler, as the marker
runs dry. A strike is drawn through the class word, a proofreader's delete loop
is written in the right-hand margin of the row, and a slip writes itself into
the margin beside the table, joined to the row by a leader line. The count in
the margin goes up by one with each row.

The margin is part of the sheet, not a card list. Slips are in table order, so
leaders never cross. Clicking a slip scrolls its row to the middle and outlines
both in ink; clicking a row's mark scrolls its slip into view. "stet" on a slip
lets that label stand: the stroke fades, the strike goes, and the delete loop
becomes the word stet.

It is interruptible: any wheel, key or pointer input ends the tour and marks
the remaining rows at once. Strokes, strikes and slips run on transform,
opacity and clip-path. The one exception is the delete loop, which is an SVG
stroke-dashoffset on a 36 px path. Under reduced motion the finished state
appears at once.

## Three choices

1. **Ground: cold neutral white.** Page `#edeef0`, sheets `#ffffff`, ink
   `#14171c`. Hairlines and a solid ink rule on top of each panel do the
   structure; there are no shadows and no gradients.
2. **One accent: highlighter pink.** `#ff2e93` as a fill and bar, `#ffd0e6` as
   a wash behind text, `#b8005f` for pink text. Pink marks a doubt and
   nothing else: the stroke, the strike, the loop, the leader and the figure in
   a slip. Selection is an ink outline. Errors are ink.
3. **Type: TikTok Sans and Spline Sans Mono, both SIL OFL, self-hosted.** The
   sans carries headings, chips and the accuracy figure at weight 800; the
   mono carries every cell, row number, column header and rule condition, with
   tabular figures.

## Label states are shapes, then colour

| State | Chip |
| --- | --- |
| Human label | hairline outline, ink text |
| Proposed | no outline, grey text |
| Unsure | dashed grey outline |
| Unlabelled | no outline, dotted underline |

Pink never marks a state; it marks a doubt. Unflagged labels stay light so
only flagged rows carry weight.

## Layout

An ink app bar names what is open: the file, the target column, the row count
and whether the model is up to date. Below it, the sheet is the table and its
margin side by side. The table fixes one precision per column, so decimals
align, and sizes columns to their content. A label shows only its class: a
hairline outline says a person gave it, plain italic says the model proposed
it, a dashed outline says unsure, a dash says nothing yet. The words
"Labelled" and "Proposed" stay in the page for screen readers.

Rule lines read as intervals, `flipper_length ≤ 206.5 · 40.75 < bill_length ≤ 42.35`,
with the unit suffix dropped; the exported SQL keeps every test exactly.

Below the sheet: export and rule, accuracy, the file and target form, and the
leak list. Under 62rem everything is one column: target, table, margin, then
the rest. The table scrolls inside its own region with the row number and the
label column fixed, and rows stop under the header rather than half-cut.

## Siblings

Siblings: Forecastle (pale blue stock with green and ochre inks, Barlow
Condensed and Source Sans 3), Promcast (near-black ground with chartreuse),
Scrub (navy and pale blue with a red accent, Newsreader and Public Sans),
Pocket Wind Tunnel (Archivo and JetBrains Mono). Shared with each at most one
of ground family (light and cool, shared with Forecastle and Scrub only),
accent family (pink, shared with none) and type pairing (shared with none).
No signature device is shared. Not used anywhere: IBM Plex, Fraunces, Inter,
warm paper, near-black grounds, amber or ochre.

## What must not change

- State is told by shape and text before colour.
- Pink appears only where something deserves a second look.
- Text and control edges meet WCAG 2.2 AA; `frontend/tests/tokens.contrast.test.ts`
  checks every pair in `frontend/src/styles/tokens.css`.
- Focus is a 2 px ink outline with a 2 px offset.
- No spinners: a thin line runs for waiting, and stops under reduced motion.

## States covered

Connecting (a running line), no table (the open-a-file panel alone), an error
(an ink-bordered banner with its next step), refit in progress (a line and the
count in the table, and "model updating" in the app bar), a table with no
target, no accuracy figure yet, long labels and long names (ellipsis with the
full text in a title), and many columns. In the dev server, `/?state=empty`,
`error`, `refit` and `loading` show the ones the demo server cannot hold still.
