# Launch stills

Regenerate the two stills after building the local application:

```sh
pnpm --dir frontend build
node scripts/capture_launch.mjs
```

The existing `scripts/record_demo.mjs` records the GIF; it has no still-image
output. The still capture uses the same pinned local TabICLv2 teacher and
`scripts/mislabel_demo.py` fixture in a temporary session. It opens the current
audit view with one disagreement selected, without changing any labels.

The direction remains `DESIGN.md`: transit bands, class roundels and the glass
lens. Both PNGs were read and visually inspected after capture. They show
“9 labels disagree with the teacher” and individual review; neither contains
“wrong line” or “Fix all 9”. Their original sizes are preserved: `hero.png` is
1440 × 900 and `social-preview.png` is 1280 × 640. Capture zoom frames the current
app without changing its copy, data or styles.
