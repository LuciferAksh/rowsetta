<script lang="ts">
  import { BROWSER } from './browser/config';
  import { onDestroy, untrack } from 'svelte';
  import { MediaQuery, SvelteMap } from 'svelte/reactivity';
  import AuditControls from './AuditControls.svelte';
  import AuditProgress from './AuditProgress.svelte';
  import InterchangeTracks from './InterchangeTracks.svelte';
  import type { Drawn, Ghost } from './interchange';
  import InterchangeReadings from './InterchangeReadings.svelte';
  import { missingAuditLabels, shownSuspects } from './audit';
  import type { ByRow, LeafLine } from './backend/types';
  import Loupe from './Loupe.svelte';
  import { bandColour, lineColour } from './palette';
  import { columnDecimals, lineFilter } from './rule';
  import type { WholeTable } from './rows';
  import type { Studio } from './state.svelte';
  import {
    layoutMap,
    legs,
    offsetLine,
    branchSentence,
    restNear,
    restAlong,
    nearestOn,
    overlaps,
    typeLines,
    typeWidth,
    type Rect,
    type Doubt,
    type Point,
    type Station,
    type Terminus,
    type TransitMap,
  } from './transit';
  import type { Stroke } from './lens';

  let { studio }: { studio: Studio } = $props();

  const MIN_LABELLED = 10;
  const DYE_MS = 900;
  const MORPH_MS = 760;
  const LIFT_MS = 220;
  // The signs read smaller than station names at the same font size.
  const SIGN_SIZE = 14;
  // Must match Loupe.svelte's bevel.
  const BEVEL = 18;
  const LAY_MS = 1100;
  const REDRAW_MS = 700;
  const GHOST_HOLD_MS = 2000;
  const GHOST_STEP_MS = 320;
  const GHOST_FOLD_MS = 520;
  const foldAt = (ghost: { order: number }): number =>
    GHOST_HOLD_MS + ghost.order * GHOST_STEP_MS;
  const RIDE_MS = 1300;
  const FONT = "Ronzino, 'Helvetica Neue', Arial, sans-serif";

  const calm =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = new MediaQuery('(max-width: 40rem)', false);

  let pending = $state.raw<ByRow<string>>({});
  let frozen = $state.raw<typeof studio.rule>(null);
  let awaiting = $state<number | null>(null);
  let ghosts = $state.raw<Ghost[]>([]);
  let merged = $state.raw<Ghost[]>([]);
  let landed = $state<number | null>(null);
  let tally = $state<number | null>(null);
  let receiving = $state.raw<ReadonlySet<string>>(new Set());

  const workspace = $derived(studio.workspace);
  const classes = $derived(workspace?.classes ?? []);
  const human = $derived(workspace?.human ?? {});
  const proposals = $derived(workspace?.proposals ?? {});
  const rule = $derived(frozen ?? studio.rule);
  const decimals = $derived(columnDecimals(studio.page?.rows ?? []));
  const labelled = $derived(
    Object.keys(human).length + Object.keys(proposals).length,
  );

  let table = $state.raw<WholeTable | null>(null);
  let width = $state(0);
  let height = $state(0);
  const narrow = $derived(width > 0 && width < 640);
  const OVERVIEW = [1000, 900] as const;
  const ink = $derived(phone.current && width > 0 ? OVERVIEW[0] / width : 1);

  let held = $state.raw<ByRow<string> | null>(null);
  let holding = 0;
  const drawnHuman = $derived(held ?? { ...human, ...pending });

  // A row with most of its values missing gives the model nothing to read.
  const sparse = $derived.by(() => {
    const found = new SvelteMap<number, string>();
    if (table === null || studio.suspects === null) return found;
    const columns = table.columns.filter((c) => c.name !== workspace?.target);
    for (const suspect of studio.suspects.slice(0, 10)) {
      const row = table.rows.get(suspect.row_id);
      if (row === undefined || columns.length === 0) continue;
      const missing = columns.filter((c) => row[c.name] == null).length;
      if (missing * 2 >= columns.length) {
        found.set(
          suspect.row_id,
          `${String(missing)} of ${String(columns.length)} values missing`,
        );
      }
    }
    return found;
  });

  const shown = $derived(shownSuspects(studio.suspects, human, studio.kept));
  // Rows with too few values sit apart, so the list and the headline count the same rows.
  const listed = $derived(
    [...shown.values()].filter((item) => !sparse.has(item.suspect.row_id)),
  );
  const thin = $derived(
    [...shown.values()].filter((item) => sparse.has(item.suspect.row_id)),
  );
  // The threads follow the labels as drawn, so a fixed one stays until its dye has run.
  const drawnShown = $derived(
    shownSuspects(studio.suspects, drawnHuman, studio.kept),
  );
  const doubts = $derived(
    [...drawnShown.values()]
      .filter(
        (item) => item.state === 'open' && !sparse.has(item.suspect.row_id),
      )
      .map((item): Doubt => ({
        row: item.suspect.row_id,
        rank: item.rank + 1,
        given: item.suspect.given,
        likely: item.suspect.likely,
        probability: item.suspect.given_probability,
      })),
  );

  const map = $derived.by((): TransitMap | null => {
    if (rule === null || width === 0 || height === 0) return null;
    return layoutMap(
      rule.leaf_summary,
      // On a phone the map is a miniature: laid out at desk size without its
      // type, then scaled to the column. Narrow windows dock the card below.
      phone.current
        ? {
            width: OVERVIEW[0],
            height: OVERVIEW[1],
            labels: 34 * ink,
            type: false,
          }
        : {
            width,
            height: narrow ? height * 0.58 : height,
            labels: narrow ? 34 : 268,
            type: !narrow,
          },
      drawnHuman,
      proposals,
      classes,
      doubts,
      decimals,
    );
  });

  // The termini when the audit landed, so fixing can be measured against them.
  let terminiBefore = $state<number | null>(null);
  $effect(() => {
    if (studio.suspects === null) {
      terminiBefore = null;
      return;
    }
    const count = rule?.leaf_summary.length;
    const current = rule?.generation === workspace?.generation;
    if (count !== undefined && current) {
      untrack(() => {
        terminiBefore ??= count;
      });
    }
  });

  let drawnFor = '';
  $effect(() => {
    if (workspace?.loaded !== true || workspace.target === null) return;
    if (labelled < MIN_LABELLED) return;
    // The rule is fitted on the model's proposals, so wait for a refit to land.
    if (workspace.refit_generation !== workspace.generation) return;
    const key = `${String(workspace.generation)}:${String(workspace.refit_generation)}`;
    if (key === drawnFor) return;
    const delay = untrack(() => studio.rule) === null ? 0 : REDRAW_MS;
    const timer = setTimeout(() => {
      drawnFor = key;
      void studio.showRule();
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  });

  let checked = false;
  const missingAudit = $derived(missingAuditLabels(classes, human));
  let checking = $state(false);
  async function check(): Promise<void> {
    if (BROWSER || checking || missingAudit.length > 0) return;
    checking = true;
    merged = [];
    await studio.checkLabels();
    if (studio.suspects !== null && studio.problem === null) checked = true;
    checking = false;
  }
  $effect(() => {
    if (BROWSER) return;
    if (workspace?.loaded !== true || workspace.target === null) return;
    if (missingAudit.length > 0) return;
    if (checked || studio.suspects !== null || untrack(() => checking)) return;
    void untrack(check);
  });

  $effect(() => {
    if (studio.suspects === null || table !== null) return;
    let active = true;
    void studio.wholeTable().then((whole) => {
      if (active) table = whole;
    });
    return () => {
      active = false;
    };
  });

  function drawnOf(next: TransitMap): Drawn[] {
    return next.bands.map((band) => ({
      key: band.key,
      points: band.points.map((p): Point => [p[0], p[1]]),
      width: band.width,
      colour: bandColour(classes, band.cls, band.kind),
      casing: band.doubt !== null,
      row: band.doubt?.row ?? null,
      rows: band.rows,
      opacity: 1,
    }));
  }

  let fixing = $state.raw<ReadonlySet<number>>(new Set());
  let bands = $state.raw<Drawn[]>([]);
  let reveal = $state(1);
  let frame = 0;
  let laidAt = '';
  let dyed: Partial<Record<number, string>> = {};
  let trails = $state.raw<{ key: string; d: string; colour: string }[]>([]);
  let dyes = $state.raw<
    {
      key: string;
      row: number;
      d: string;
      colour: string;
      width: number;
      delay: number;
      duration: number;
    }[]
  >([]);

  const ease = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

  const same = (a: readonly Drawn[], b: readonly Drawn[]): boolean =>
    a.length === b.length &&
    a.every((band, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        band.key === other.key &&
        band.width === other.width &&
        band.colour === other.colour &&
        band.points.every((p, j) => {
          const q = other.points[j];
          return q !== undefined && p[0] === q[0] && p[1] === q[1];
        })
      );
    });

  const shape = (drawn: readonly Drawn[]): string =>
    [...new Set(drawn.map((band) => band.key.slice(0, band.key.indexOf('|'))))]
      .sort()
      .join();

  function relay(next: Drawn[]): void {
    const from = bands;
    const start = performance.now();
    const step = (now: number): void => {
      const t = (now - start) / LIFT_MS;
      if (t < 1) {
        bands = from.map((band) => ({ ...band, opacity: 1 - t }));
        frame = requestAnimationFrame(step);
        return;
      }
      bands = next;
      const u = Math.min((now - start - LIFT_MS) / LAY_MS, 1);
      reveal = 1 - (1 - u) ** 3;
      if (u < 1) frame = requestAnimationFrame(step);
    };
    reveal = 0;
    frame = requestAnimationFrame(step);
  }

  function morph(next: Drawn[], size: string): void {
    if (same(bands, next)) return;
    cancelAnimationFrame(frame);
    reveal = 1;
    const from = bands;
    if (from.length === 0 || calm || size !== laidAt) {
      laidAt = size;
      bands = next;
      return;
    }
    if (shape(from) !== shape(next)) {
      relay(next);
      return;
    }
    const before = new Map(from.map((band) => [band.key, band]));
    const keys = new Set(next.map((band) => band.key));
    const pairs: { a: Drawn; b: Drawn; fold: boolean; keep?: boolean }[] = [];
    for (const a of from) {
      if (keys.has(a.key)) continue;
      const colour = (a.row !== null ? dyed[a.row] : undefined) ?? a.colour;
      const into =
        a.row !== null
          ? next.find(
              (band) =>
                band.key ===
                `${a.key.slice(0, a.key.lastIndexOf('|'))}|human:${drawnHuman[String(a.row)] ?? ''}`,
            )
          : undefined;
      const b =
        into !== undefined && into.points.length === a.points.length
          ? {
              ...into,
              key: a.key,
              width: a.width,
              rows: a.rows,
              colour,
              casing: false,
            }
          : { ...a, opacity: 0 };
      const keep = false;
      pairs.push({ a: { ...a, colour }, b, fold: true, keep });
    }
    for (const b of next) {
      const a = before.get(b.key);
      pairs.push({
        a:
          a !== undefined && a.points.length === b.points.length
            ? a
            : { ...b, opacity: 0 },
        b,
        fold: false,
      });
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min((now - start) / MORPH_MS, 1);
      const e = ease(t);
      bands = pairs.map(({ a, b, fold, keep }) => ({
        key: b.key,
        points: a.points.map((p, i): Point => [
          p[0] + ((b.points[i]?.[0] ?? p[0]) - p[0]) * e,
          p[1] + ((b.points[i]?.[1] ?? p[1]) - p[1]) * e,
        ]),
        width: a.width + (b.width - a.width) * e,
        colour: keep === true ? b.colour : e < 0.5 ? a.colour : b.colour,
        casing: fold ? a.casing && t < 0.25 : b.casing,
        rows: b.rows,
        row: fold ? a.row : b.row,
        opacity:
          keep === true
            ? 1
            : fold
              ? 1 - Math.max(0, (t - 0.75) / 0.25)
              : a.opacity + (b.opacity - a.opacity) * e,
      }));
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        bands = next;
        // Only the threads this fold carried; a later drop may already be dyed.
        for (const { a, fold } of pairs) {
          if (fold && a.row !== null) dyed[a.row] = undefined;
        }
        trails = [
          ...trails,
          ...pairs
            .filter((pair) => pair.keep === true)
            .map(({ a, b }) => ({
              key: a.key,
              d: path(b.points),
              colour: b.colour,
            })),
        ];
      }
    };
    frame = requestAnimationFrame(step);
  }

  $effect(() => {
    if (map === null) return;
    const next = drawnOf(map);
    const size = `${String(map.width)}x${String(map.height)}`;
    untrack(() => {
      morph(next, size);
    });
  });

  const path = (points: readonly Point[]): string =>
    points
      .map(
        (p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`,
      )
      .join('');

  const PITCH = 2.4;
  const magnify = $derived(
    map === null ? 4 : Math.min(12, Math.max(3, PITCH * map.rowsPerPx)),
  );

  function hairlines(band: Drawn): string {
    const n = band.rows;
    if (n <= 1) return path(band.points);
    const spacing = band.width / n;
    let d = '';
    for (let k = 0; k < n; k++) {
      d += path(offsetLine(band.points, (k + 0.5 - n / 2) * spacing));
    }
    return d;
  }

  const lifted = $derived(
    new Set([
      ...fixing,
      ...(studio.selectedRow === null ? [] : [studio.selectedRow]),
    ]),
  );

  function routeOfRow(row: number): Point[] {
    return bands
      .filter((band) => band.row === row)
      .sort(byRoute)
      .flatMap((band) => band.points);
  }

  function threadPath(row: number): string {
    return path(routeOfRow(row));
  }

  let anchored: { lens: Point; at: Point } | null = null;
  const focus = $derived.by((): Point => {
    for (const row of lifted) {
      const near = nearestOn(routeOfRow(row), lens);
      if (
        near !== null &&
        Math.abs(near.at[0] - lens[0]) < half[0] &&
        Math.abs(near.at[1] - lens[1]) < half[1]
      ) {
        anchored = { lens, at: near.at };
        return near.at;
      }
    }
    // A glass left where a fix dropped its row keeps the same picture.
    if (anchored?.lens === lens) return anchored.at;
    anchored = null;
    return lens;
  });

  const glassStrokes = $derived.by((): (Stroke & { key: string })[] => {
    const px = 1 / magnify;
    const parted = map !== null && magnify / map.rowsPerPx >= 1.5;
    const out: (Stroke & { key: string })[] = [];
    for (const band of bands) {
      if (band.row !== null && lifted.has(band.row)) continue;
      const rows = band.row === null && parted;
      out.push({
        key: band.key,
        d: rows ? hairlines(band) : path(band.points),
        colour: band.colour,
        width: rows
          ? Math.max((band.width / Math.max(band.rows, 1)) * 0.7, px)
          : band.row === null
            ? band.width
            : px * 2.5,
        opacity: band.opacity,
      });
    }
    for (const row of lifted) {
      const band = bands.find((b) => b.row === row);
      if (band === undefined) continue;
      const d = threadPath(row);
      out.push(
        {
          key: `lift-casing-${String(row)}`,
          d,
          colour: '#0d0d0d',
          width: px * 7,
          opacity: band.opacity,
        },
        {
          key: `lift-${String(row)}`,
          d,
          colour: band.colour,
          width: px * 4,
          opacity: band.opacity,
        },
      );
    }
    return out;
  });

  const trunk = $derived(
    bands
      .filter((band) => band.key.startsWith('in|'))
      .reduce((sum, band) => sum + band.width + 1.5, 0),
  );

  const byRoute = (a: { key: string }, b: { key: string }): number => {
    const depth = (band: { key: string }): number => {
      const edge = band.key.slice(0, band.key.indexOf('|'));
      return edge === 'in' ? -1 : edge.length;
    };
    return depth(a) - depth(b);
  };

  const length = (points: readonly Point[]): number =>
    legs(points).reduce(
      (sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]),
      0,
    );

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const half = $derived<[number, number]>(narrow ? [92, 62] : [92, 64]);

  const solid = $derived.by((): Rect[] => {
    if (map === null) return [];
    return [
      [map.terminusX - 48, 0, map.width, map.height],
      [0, map.height - 80, map.origin[0] + 350, map.height],
      // The origin's count and trunk; the open sky above them is fair ground.
      [0, map.origin[1] - 100, map.origin[0] + 80, map.height],
      ...map.stations.map((station): Rect => [
        station.x - 12,
        station.y - station.half - 6,
        station.x + 12,
        station.y + station.half + 6,
      ]),
    ];
  });

  function typeBoxes(station: Station): [Rect, Rect, Rect] {
    const [name, upper, lower] = typeLines(station.split, station.upLeft);
    const { label } = station;
    return [
      [
        label.name[0] - typeWidth(name) - 4,
        label.name[1] - 14,
        label.name[0] + 4,
        label.name[1] + 4,
      ],
      [
        label.up[0] - 4,
        label.up[1] - SIGN_SIZE,
        label.up[0] + typeWidth(upper),
        label.up[1] + 4,
      ],
      [
        label.down[0] - 4,
        label.down[1] - SIGN_SIZE,
        label.down[0] + typeWidth(lower),
        label.down[1] + 4,
      ],
    ];
  }

  const keepClear = $derived.by((): Rect[] =>
    map === null || narrow
      ? solid
      : [...solid, ...map.stations.flatMap((station) => typeBoxes(station))],
  );

  const shoved = $derived.by((): Record<string, number> => {
    const moves: Record<string, number> = {};
    if (map === null || narrow || !parked || idle) return moves;
    const top = lens[1] - half[1] - 4;
    const bottom = lens[1] + half[1] + 4;
    const glass: Rect = [
      lens[0] - half[0] - 4,
      top,
      lens[0] + half[0] + 4,
      bottom,
    ];
    for (const station of map.stations) {
      const [name, upper, lower] = typeBoxes(station);
      // The two signs move together, so they stay one over the other.
      const units: [number[], Rect][] = [
        [[0], name],
        [
          [1, 2],
          [
            Math.min(upper[0], lower[0]),
            upper[1],
            Math.max(upper[2], lower[2]),
            lower[3],
          ],
        ],
      ];
      for (const [lines, box] of units) {
        if (!overlaps(box, glass)) continue;
        const up = top - box[3];
        const down = bottom - box[1];
        for (const line of lines) {
          moves[`${station.key}:${String(line)}`] = -up < down ? up : down;
        }
      }
    }
    return moves;
  });

  const nudge = (station: Station, line: number): string | undefined => {
    const dy = shoved[`${station.key}:${String(line)}`];
    return dy === undefined ? undefined : `translateY(${String(dy)}px)`;
  };

  const inkDots = $derived.by((): [number, number, number][] => {
    const dots: [number, number, number][] = [];
    for (const [index, band] of (map?.bands ?? []).entries()) {
      for (const [a, b] of legs(band.points)) {
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6);
        for (let i = 0; i < n; i++) {
          const f = i / n;
          dots.push([
            a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            index,
          ]);
        }
      }
    }
    return dots;
  });

  const inkUnder = (at: Point): number =>
    new Set(
      inkDots
        .filter(
          ([x, y]) =>
            Math.abs(x - at[0]) < half[0] - BEVEL &&
            Math.abs(y - at[1]) < half[1] - BEVEL,
        )
        .map(([, , band]) => band),
    ).size;

  function restOn(row: number): { at: Point; through: Point[] } | null {
    if (map === null) return null;
    // The map as laid out, not as drawn: the drawing may still be mid-tween.
    const route = map.bands
      .filter((band) => band.doubt?.row === row)
      .sort(byRoute)
      .flatMap((band) => band.points);
    if (route.length < 2) return null;
    const size = [map.width, map.height] as const;
    // On the thread clear of everything, else on the thread clear of the
    // interchanges with their type moved aside, and only then beside it.
    const rest =
      restAlong(route, half, keepClear, size, false, inkUnder) ??
      restAlong(route, half, solid, size, false, inkUnder) ??
      restAlong(route, half, keepClear, size);
    if (rest !== null) {
      return { at: rest.at, through: route.slice(0, rest.before + 1) };
    }
    const at = restNear(route, half, keepClear, size);
    return at === null ? null : { at, through: [] };
  }

  function dye(doubt: Doubt, ms: number): void {
    const colour = lineColour(classes, doubt.likely);
    const thread = bands.filter((band) => band.row === doubt.row).sort(byRoute);
    const total =
      thread.reduce((sum, band) => sum + length(band.points), 0) || 1;
    let run = 0;
    dyes = [
      ...dyes,
      ...thread.map((band) => {
        const stretch = length(band.points);
        const step = {
          key: band.key,
          row: doubt.row,
          d: path(band.points),
          colour,
          width: band.width,
          delay: (run / total) * ms,
          duration: (stretch / total) * ms,
        };
        run += stretch;
        return step;
      }),
    ];
    dyed[doubt.row] = colour;
  }

  function receive(row: number): void {
    const end = map?.termini.find((t) =>
      t.doubts.some((d) => d.doubt.row === row),
    );
    if (end !== undefined) receiving = new Set([...receiving, end.key]);
  }

  async function fix(doubt: Doubt): Promise<void> {
    const context = studio.tableContext;
    if (calm) {
      await studio.label(doubt.row, doubt.likely);
      return;
    }
    const at = restOn(doubt.row)?.at ?? null;
    if (at !== null && Math.hypot(at[0] - lens[0], at[1] - lens[1]) > 2) {
      glide(at);
      await wait(340);
    }
    if (context !== studio.tableContext) return;
    receive(doubt.row);
    fixing = new Set([...fixing, doubt.row]);
    if (holding++ === 0) held = drawnHuman;
    dye(doubt, DYE_MS);
    await Promise.all([studio.label(doubt.row, doubt.likely), wait(DYE_MS)]);
    if (--holding === 0) {
      held = null;
      dyes = [];
    }
    // The fold runs once the new label lands; the map comes back when it has.
    await wait(MORPH_MS + 120);
    fixing = new Set([...fixing].filter((row) => row !== doubt.row));
    if (fixing.size === 0) receiving = new Set();
  }

  // The map holds the old rule until the server has fitted it again on every
  // new label and the redrawn rule is in.
  $effect(() => {
    if (awaiting === null || workspace === null) return;
    const fresh = studio.rule;
    if (
      fresh === null ||
      workspace.refit_generation !== workspace.generation ||
      fresh.generation !== workspace.generation
    )
      return;
    untrack(() => {
      land(fresh);
    });
  });

  function land(fresh: typeof studio.rule): void {
    const old = map;
    awaiting = null;
    idle = true;
    const release = (): void => {
      frozen = null;
      trails = [];
      ghosts = [];
      landed = null;
    };
    if (fresh === null || old === null) {
      release();
      return;
    }
    const after = fresh.leaf_summary.length;
    const before = old.termini.length;
    landed = after;
    tally = after;
    if (calm || after >= before) {
      release();
      return;
    }
    const keeper: Record<number, Terminus | undefined> = {};
    const shared = (terminus: Terminus, line: LeafLine): number => {
      const rows = new Set(terminus.line.row_ids);
      return line.row_ids.filter((id) => rows.has(id)).length;
    };
    const goes = old.termini.map((terminus) => {
      let into = fresh.leaf_summary[0];
      for (const line of fresh.leaf_summary) {
        if (
          into === undefined ||
          shared(terminus, line) > shared(terminus, into)
        )
          into = line;
      }
      const best = into === undefined ? undefined : keeper[into.line_no];
      if (
        into !== undefined &&
        (best === undefined || shared(terminus, into) > shared(best, into))
      ) {
        keeper[into.line_no] = terminus;
      }
      return { terminus, into };
    });
    ghosts = goes
      .flatMap(({ terminus, into }) => {
        const target = into === undefined ? undefined : keeper[into.line_no];
        return into === undefined ||
          target === undefined ||
          target.key === terminus.key
          ? []
          : [
              {
                key: terminus.key,
                label: terminus.line.label,
                rows: terminus.line.row_ids.length,
                into,
                toY: target.y - terminus.y,
                order: 0,
              },
            ];
      })
      .map((ghost, order) => ({ ...ghost, order }));
    merged = ghosts;
    tally = before;
    for (const ghost of ghosts) {
      void wait(foldAt(ghost) + GHOST_FOLD_MS).then(() => {
        tally = Math.max(after, (tally ?? before) - 1);
      });
    }
    void wait(foldAt({ order: ghosts.length }) + GHOST_FOLD_MS).then(release);
  }

  let idle = $state(false);

  // Keep the terminus name in view beside the glass's right edge.
  let lens = $state<Point>([0, 0]);
  let parked = $state(false);
  let travelling = $state(false);
  const reach = $derived(narrow ? 24 - 92 : 34 - 92);
  let placed = false;
  let ride = 0;
  onDestroy(() => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(ride);
    }
  });

  interface Stop {
    key: string;
    at: Point;
    station: Station | null;
    terminus: Terminus | null;
  }

  const stops = $derived.by((): Stop[] => {
    if (map === null) return [];
    const lensAt = (t: Terminus): Point => [t.x + reach, t.y];
    return [
      ...[...map.stations]
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((station) => ({
          key: `s${station.key}`,
          at: [station.x + 40, station.y] as Point,
          station,
          terminus: null,
        })),
      ...[...map.termini]
        .sort((a, b) => a.y - b.y)
        .map((terminus) => ({
          key: `t${terminus.key}`,
          at: lensAt(terminus),
          station: null,
          terminus,
        })),
    ];
  });

  const reading = $derived.by((): Stop | null => {
    let best: Stop | null = null;
    let distance = 90;
    for (const stop of stops) {
      const d = Math.hypot(stop.at[0] - lens[0], stop.at[1] - lens[1]);
      if (d < distance) {
        distance = d;
        best = stop;
      }
    }
    return best;
  });

  const selected = $derived(
    doubts.find((doubt) => doubt.row === studio.selectedRow) ?? null,
  );

  function glide(
    to: Point,
    through: readonly Point[] = [],
    duration = through.length > 0 ? RIDE_MS : 320,
  ): void {
    cancelAnimationFrame(ride);
    parked = false;
    const route = legs([lens, ...through, to]).map(([a, b]) => ({
      a,
      b,
      length: Math.hypot(b[0] - a[0], b[1] - a[1]),
    }));
    const last = route.at(-1);
    const total = route.reduce((sum, leg) => sum + leg.length, 0);
    if (calm || total < 1 || last === undefined) {
      lens = to;
      parked = true;
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      let along = ease(t) * total;
      let leg = last;
      let f = 1;
      for (const next of route) {
        if (along <= next.length) {
          leg = next;
          f = next.length === 0 ? 1 : along / next.length;
          break;
        }
        along -= next.length;
      }
      const { a, b } = leg;
      lens = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      if (t < 1) ride = requestAnimationFrame(step);
      else parked = true;
    };
    ride = requestAnimationFrame(step);
  }

  function read(doubt: Doubt): void {
    idle = false;
    studio.selectedRow = doubt.row;
    const rest = restOn(doubt.row);
    if (rest === null || map === null) return;
    glide(rest.at, [map.origin, ...rest.through.slice(1)]);
  }

  $effect(() => {
    if (map === null) return;
    if (!placed) {
      const first = map.stations[0];
      lens = first ? [first.x + 40, first.y] : [map.width / 2, map.height / 2];
      placed = true;
    }
  });
  let introduced = false;
  $effect(() => {
    const first = wrong[0];
    if (introduced || map === null || first === undefined) return;
    introduced = true;
    untrack(() => {
      read(first);
    });
  });

  const wrong = $derived(
    doubts.filter((doubt) => doubt.likely !== doubt.given),
  );
  const termini = $derived(landed ?? rule?.leaf_summary.length ?? 0);
  const fixedCount = $derived(
    [...drawnShown.values()].filter((item) => item.state === 'fixed').length,
  );
  const headline = $derived.by(() => {
    if (rule === null) {
      return labelled < MIN_LABELLED
        ? 'Label a few rows and the rule draws itself here.'
        : 'Drawing the rule.';
    }
    if (checking) return `Reading ${String(Object.keys(human).length)} labels.`;
    if (wrong.length === 1) return '1 label disagrees with the teacher.';
    if (wrong.length > 1)
      return `${String(wrong.length)} labels disagree with the teacher.`;
    if (fixedCount > 0 && terminiBefore !== null) {
      const fewer = terminiBefore - termini;
      return fewer > 0
        ? `${String(fixedCount)}\u00a0fixed. ${String(fewer)}\u00a0fewer\u00a0termini.`
        : `${String(fixedCount)} fixed. Every doubted label rides its own line.`;
    }
    return studio.suspects === null
      ? `${String(termini)} ${termini === 1 ? 'line carries' : 'lines carry'} every row.`
      : 'No doubted label disagrees with the teacher.';
  });
  const clauses = $derived(
    headline
      .split(/(?<=\.) /)
      .map((clause, i, all) => (i < all.length - 1 ? `${clause} ` : clause)),
  );
  const lede = $derived.by(() => {
    const audited = studio.suspects?.length ?? 0;
    if (rule === null) {
      return 'Each split the rule learns becomes an interchange, and each answer a terminus.';
    }
    if (checking) {
      return `The model scores every label with its own row held out, so it never grades a label it has already seen.`;
    }
    if (awaiting !== null) {
      return `All ${String(awaiting)} labels are in. The server is fitting the rule again on them; the map changes when it lands.`;
    }
    if (wrong.length > 0) {
      return `The model read ${String(audited)} human labels, each with its own row held out. Review each suggested label before changing it. A label the teacher doubts rides the map as a thread in that label's colour.`;
    }
    if (fixedCount > 0 && terminiBefore !== null) {
      return terminiBefore === termini
        ? `Each fixed thread took the colour of the line it rides, and the rule was fitted again with the same ${String(termini)} termini.`
        : `Each fixed thread took the colour of the line it rides, and the rule was fitted again: ${String(terminiBefore)} termini became ${String(termini)}.`;
    }
    return `Every row enters at the left and rides the rule's splits to a terminus. Under the glass, each line parts into its rows.`;
  });

  function rowsAt(
    stop: Stop,
  ): { row: number; label: string; cells: string[] }[] {
    const reached =
      stop.terminus !== null
        ? stop.terminus.line.row_ids
        : stop.station !== null
          ? stationRows(stop.station)
          : [];
    const columns =
      stop.station !== null
        ? [stop.station.split.column]
        : [...new Set((stop.terminus?.line.conditions ?? []).map((c) => c[0]))];
    const doubted = new Set(doubts.map((d) => d.row));
    return [...reached]
      .sort((a, b) => Number(doubted.has(b)) - Number(doubted.has(a)))
      .slice(0, 3)
      .map((row) => ({
        row,
        label: drawnHuman[String(row)] ?? proposals[String(row)] ?? 'no label',
        cells: columns.map((column) => {
          const cell = table?.rows.get(row)?.[column];
          return `${column.replace(/_(?:mm|cm|kg|g|m|s|ms)$/, '').replaceAll('_', ' ')} ${cell === null || cell === undefined ? 'missing' : String(cell)}`;
        }),
      }));
  }

  function stationRows(station: Station): number[] {
    return (rule?.leaf_summary ?? [])
      .filter((line) => {
        let key = '';
        for (const condition of line.conditions) {
          if (key === station.key) return true;
          const test = condition[1].replace(
            /^IS (?:NOT )?NULL (?:OR|AND) /,
            '',
          );
          key += test === '<=' || test === '<' || test === '<>' ? 'L' : 'R';
        }
        return false;
      })
      .flatMap((line) => line.row_ids);
  }

  let at = $state(-1);
  function onMapKey(event: KeyboardEvent): void {
    if (stops.length === 0) return;
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step !== 0 || event.key === 'Home' || event.key === 'End') {
      idle = false;
    }
    if (step !== 0) {
      event.preventDefault();
      at = (at + step + stops.length) % stops.length;
      studio.selectedRow = null;
      const stop = stops[at];
      if (stop) glide(stop.at);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      at = event.key === 'Home' ? 0 : stops.length - 1;
      const stop = stops[at];
      if (stop) glide(stop.at);
    } else if (event.key === 'Enter') {
      const doubt = reading?.terminus?.doubts[0]?.doubt;
      if (doubt) read(doubt);
    } else if (event.key === 'Escape') {
      studio.selectedRow = null;
      idle = true;
    }
  }

  function moved(to: Point): void {
    idle = false;
    parked = false;
    cancelAnimationFrame(ride);
    lens = to;
    if (selected !== null) {
      const near = nearestOn(routeOfRow(selected.row), to);
      if (near === null || near.distance > 120) studio.selectedRow = null;
    }
  }

  function showRows(terminus: Terminus): void {
    void studio.filterRows(lineFilter(terminus.line));
    document
      .getElementById('table-heading')
      ?.parentElement?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth' });
  }
</script>

{#snippet bullet(cls: string)}<span
    class="bullet"
    style:background={lineColour(classes, cls)}
    aria-hidden="true">{cls.slice(0, 1)}</span
  >{/snippet}

{#snippet roundel(x: number, y: number, answer: string | null, k = 1)}
  {#if answer === null}
    <circle
      cx={x}
      cy={y}
      r={8.5 * k}
      fill="#ffffff"
      stroke="#0d0d0d"
      stroke-width={1.5 * k}
      stroke-dasharray={`${String(3 * k)} ${String(2 * k)}`}
    />
  {:else}
    <circle cx={x} cy={y} r={9.5 * k} fill={lineColour(classes, answer)} />
    <text
      {x}
      y={y + 4 * k}
      text-anchor="middle"
      font-size={11 * k}
      font-weight="700"
      font-family={FONT}
      fill="#ffffff">{answer.slice(0, 1)}</text
    >
  {/if}
{/snippet}

{#snippet glassArt(m: TransitMap)}
  {@const px = 1 / magnify}
  {#each glassStrokes as stroke (stroke.key)}
    {#if stroke.opacity > 0}
      <path
        d={stroke.d}
        fill="none"
        stroke={stroke.colour}
        stroke-width={stroke.width}
        opacity={stroke.opacity}
      />
    {/if}
  {/each}
  {#each dyes.filter((dye) => lifted.has(dye.row)) as dye (dye.key)}
    <path
      class="dye"
      d={dye.d}
      fill="none"
      stroke={dye.colour}
      stroke-width={px * 4}
      pathLength="1"
      style:animation-delay={`${String(dye.delay)}ms`}
      style:animation-duration={`${String(dye.duration)}ms`}
    />
  {/each}
  {#each m.stations as station (station.key)}
    <rect
      x={station.x - 7}
      y={station.y - station.half}
      width="14"
      height={station.half * 2}
      rx="7"
      fill="none"
      stroke="#0d0d0d"
      stroke-width={px * 2}
    />
  {/each}
  {#each m.termini as terminus (terminus.key)}
    <rect
      x={terminus.x}
      y={terminus.y - terminus.half}
      width="6"
      height={terminus.half * 2}
      fill="#0d0d0d"
    />
  {/each}
{/snippet}

<section
  id="interchange"
  class="interchange"
  aria-labelledby="interchange-heading"
>
  <div class="notice">
    <h2
      id="interchange-heading"
      class="headline"
      class:two={clauses.length > 1}
    >
      {#each clauses as clause, i (i)}<span class="clause">{clause}</span
        >{/each}
    </h2>
    {#if merged.length > 0 && tally !== null}
      <p class="tally" aria-hidden="true">
        <span class="tally-n">{tally}</span> termini
      </p>
      <ul class="retired" aria-label="Termini the refit retired">
        {#each merged as ghost (ghost.key)}
          <li>
            <s>{ghost.label ?? 'No answer'}, {ghost.rows} rows</s>
            merges into {#if ghost.into.label !== null}{@render bullet(
                ghost.into.label,
              )}{/if}{ghost.into.label ?? 'no answer'}, {ghost.into.row_ids
              .length} rows
          </li>
        {/each}
      </ul>
    {/if}
    <AuditProgress {checking} {awaiting} refit={studio.refit} />
    <p class="lede">{lede}</p>
    <AuditControls
      hasSuspects={studio.suspects !== null}
      hasShown={shown.size > 0}
      hasRule={rule !== null}
      {checking}
      {missingAudit}
      oncheck={check}
    />
    {#if !phone.current && !idle && selected === null && reading !== null}
      {@const here = rowsAt(reading)}
      <div class="panel" aria-live="polite">
        {#if reading.station !== null}
          {@const station = reading.station}
          <p class="panel-head">
            <span class="capsule" aria-hidden="true"></span>{station.split
              .label}
          </p>
          <p class="panel-say">
            {station.rows} rows meet here. {branchSentence(
              station.split,
              station.upLeft,
            )}
          </p>
        {:else if reading.terminus !== null}
          {@const t = reading.terminus}
          <p
            class="panel-head"
            style:--line={lineColour(classes, t.line.label)}
          >
            <span class="bar" aria-hidden="true"
            ></span>{#if t.line.label !== null}{@render bullet(
                t.line.label,
              )}{:else}<span class="ring" aria-hidden="true"></span>{/if}{t.line
              .label ?? 'No answer'}
            <span class="sub">line {t.line.line_no}</span>
          </p>
          <p class="panel-say">
            {t.line.row_ids.length} rows{#each t.counts as [cls, n] (cls)}{`, ${String(n)} labelled ${cls}`}{/each}.
            {t.line.agree.k} of {t.line.agree.n} agree with the model.
          </p>
        {/if}
        <ul class="here" class:hidden={table === null}>
          {#each here as r (r.row)}
            {@const doubt = doubts.find((d) => d.row === r.row)}
            <li>
              {#if doubt}
                <button
                  type="button"
                  class="here-row"
                  onclick={() => {
                    read(doubt);
                  }}
                  ><span class="roundel" aria-hidden="true">{doubt.rank}</span
                  >Row {r.row}</button
                >
              {:else}
                <span class="here-row">Row {r.row}</span>
              {/if}
              {@render bullet(r.label)}<span>{r.label}</span>
              <span class="sub">{r.cells.join(' · ')}</span>
            </li>
          {/each}
        </ul>
        {#if reading.terminus !== null}
          {@const t = reading.terminus}
          <button
            type="button"
            class="button"
            onclick={() => {
              showRows(t);
            }}>Show its {t.line.row_ids.length} rows in the table</button
          >
        {/if}
      </div>
    {/if}
    {#if studio.suspects !== null && shown.size > 0}
      <InterchangeReadings
        {studio}
        {table}
        {rule}
        {classes}
        {decimals}
        {listed}
        {thin}
        {sparse}
        {doubts}
        phone={phone.current}
        onread={read}
        onfix={fix}
        onidle={() => {
          idle = true;
        }}
        {bullet}
        {roundel}
      />
    {/if}
  </div>

  <div
    class="stage"
    class:stage--empty={rule === null}
    bind:clientWidth={width}
    bind:clientHeight={height}
  >
    {#if map !== null}
      <svg
        class="map"
        width={map.width}
        height={map.height}
        viewBox={`0 0 ${String(map.width)} ${String(map.height)}`}
        role="img"
        aria-label={`The rule as a line map: ${String(map.stations.length)} interchanges and ${String(map.termini.length)} termini. The rule's lines are listed under Export.`}
      >
        <InterchangeTracks
          m={map}
          id="lay-map"
          {bands}
          {trails}
          {dyes}
          {fixing}
          {receiving}
          {ghosts}
          {reveal}
          {trunk}
          {narrow}
          phone={phone.current}
          {ink}
          selectedRow={selected?.row ?? null}
          {fixedCount}
          rowCount={studio.rowCount}
          {classes}
          {calm}
          font={FONT}
          {LIFT_MS}
          {LAY_MS}
          {GHOST_FOLD_MS}
          {foldAt}
          {nudge}
          {roundel}
        />
      </svg>
      {#if !phone.current}
        <button
          type="button"
          class="keys"
          aria-label="Line map. Arrow keys move the glass between interchanges and termini; Enter reads a doubted row there."
          onkeydown={onMapKey}
        ></button>
        <Loupe
          {focus}
          {map}
          at={lens}
          strokes={glassStrokes}
          {narrow}
          {magnify}
          away={travelling || idle}
          onmove={moved}
        >
          {#snippet glass(m: TransitMap)}
            {@render glassArt(m)}
          {/snippet}
        </Loupe>
        <p class="legend" style:left={`${String(map.origin[0])}px`}>
          Width is rows carried, 1 px for every {Math.max(
            1,
            Math.round(map.rowsPerPx * 10) / 10,
          )} rows. A thread is one row whose label the model doubts, in that label's
          colour. Percent: how likely the model finds the label a person gave.
        </p>
      {/if}
    {:else}
      <div class="empty" aria-hidden="true"></div>
    {/if}
  </div>
</section>

<style>
  .interchange {
    grid-area: map;
    display: grid;
    grid-template-columns: 23rem minmax(0, 1fr);
    height: clamp(40rem, calc(100dvh - 3rem), 60rem);
    border-bottom: var(--rule);
    background: var(--sheet);
  }
  .stage--empty {
    display: none;
  }
  .interchange:has(.stage--empty) {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
  }
  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-5) var(--space-5);
    min-height: 0;
    overflow: auto;
  }
  .headline {
    font-size: var(--step-peak);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  .clause {
    display: block;
  }
  .headline.two {
    font-size: min(var(--step-peak), 2.5rem);
  }
  .lede {
    color: var(--ink-2);
    max-width: 36ch;
  }
  .roundel {
    display: inline-grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: var(--ink);
    color: var(--on-ink);
    font-size: 0.6875rem;
    font-weight: 700;
    flex: none;
  }
  .bullet {
    display: inline-grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    color: #ffffff;
    font-size: 0.625rem;
    font-weight: 700;
    flex: none;
    vertical-align: -0.2em;
    margin-right: 0.2rem;
  }
  .stage {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--line);
  }
  .map {
    position: absolute;
    inset: 0;
    display: block;
  }
  .keys {
    appearance: none;
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    pointer-events: none;
  }
  .keys:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -6px;
    box-shadow: none;
  }
  @keyframes fold {
    to {
      transform: translateY(var(--fold));
      opacity: 0;
    }
  }
  .tally {
    margin: 0;
    font-size: var(--step-0);
    font-weight: 700;
  }
  .retired {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--step--1);
  }
  .retired s {
    font-weight: 700;
    color: var(--ink-3);
  }
  .tally-n {
    display: inline-block;
    font-size: var(--step-2);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .dye {
    stroke-dasharray: 1 1;
    stroke-dashoffset: 1;
    animation: dye 900ms linear forwards;
  }
  @keyframes dye {
    to {
      stroke-dashoffset: 0;
    }
  }
  .here {
    display: grid;
    border-top: 1px solid var(--line);
  }
  .here li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem 0.4rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }
  .here .sub {
    flex-basis: 100%;
  }
  .here-row {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: transparent;
    padding: 0;
    font-weight: 700;
    cursor: pointer;
  }
  span.here-row {
    cursor: default;
  }
  .here.hidden {
    display: none;
  }

  .panel {
    display: grid;
    gap: var(--space-2);
    font-size: var(--step--1);
    border-top: 3px solid var(--ink);
    padding-top: var(--space-2);
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--step-1);
    font-weight: 700;
  }
  .capsule {
    width: 0.6rem;
    height: 1.3rem;
    border: 2.5px solid var(--ink);
    border-radius: 0.3rem;
    flex: none;
  }
  .bar {
    width: 5px;
    height: 1.3rem;
    background: var(--ink);
    flex: none;
  }
  .ring {
    width: 1.05rem;
    height: 1.05rem;
    border: 1.5px dashed var(--ink);
    border-radius: 50%;
    flex: none;
  }
  .sub {
    color: var(--ink-2);
    font-weight: 400;
    font-size: var(--step--1);
  }
  .legend {
    position: absolute;
    text-align: left;
    bottom: var(--space-4);
    max-width: 21rem;
    font-size: 0.75rem;
    color: var(--ink-2);
    pointer-events: none;
  }

  @media (max-width: 40rem) {
    .interchange {
      grid-template-columns: minmax(0, 1fr);
      height: auto;
    }
    .interchange {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-5) var(--space-4) var(--space-4);
    }
    .notice {
      display: contents;
    }
    .notice > :global(*) {
      order: 2;
    }
    .headline {
      order: 0;
    }
    .stage {
      order: 1;
      aspect-ratio: 1000 / 900;
      border-left: 0;
    }
    .map {
      width: 100%;
      height: 100%;
    }
  }
</style>
