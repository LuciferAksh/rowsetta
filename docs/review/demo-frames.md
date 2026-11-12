# Demo GIF review

The capture uses the pinned local TabICLv2 model and the Palmer penguins table,
with nine labels changed by `scripts/mislabel_demo.py`. The first session labels
six rows, shows proposals and unsure rows, and checks twenty random rows blind.
The second session takes the existing species column and shows the audit lens
following a doubtful row. Its SQL certificate belongs to that audit session,
not to the preceding six-label evaluation. The final certificate caption is
read from the export and holds for more than 2.5 seconds.

The 3 fps contact sheets below were inspected at 640 px per frame:

- `demo-sheet-01.png`: the first label and promise are visible immediately;
  proposals, evaluation, the lens ride, and the start of export are visible.
- `demo-sheet-02.png`: the SQL panel and certificate caption remain visible in
  both sampled frames. Blank tiles are padding after the end of the GIF.

Captions remain inside the frame and no spinner appears. The product's SQL
panel scrolls horizontally, so the long `SELECT` line is clipped at its right
edge; this is a remaining limitation against the no-clipped-text review gate.
The first session's evaluation and the audit export are separate real runs.
