/**
 * Text-line detection by image analysis (no OCR): binarise, label connected
 * components, then chain character-sized components into lines. Unlike
 * Tesseract's own layout analysis it does not skip sparse or oddly spaced
 * text, and it separates out illustrations, ruby (furigana) and dot leaders.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectedLine extends Box {
  /** Ruby (furigana) boxes sitting on this line: erased with it, never translated. */
  ruby: Box[];
}

interface Comp extends Box {
  area: number;
}

/**
 * Long side of the analysis bitmap. OCR bitmaps (≤ 3500 px) are analysed at
 * full size: downscaling turns thin strokes such as ruby grey and loses them.
 */
const ANALYSIS_SIDE = 3600;

const w = (b: Box) => b.x1 - b.x0;
const h = (b: Box) => b.y1 - b.y0;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Otsu threshold over a greyscale histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Connected components (8-connected) via run-length union-find. */
function components(ink: Uint8Array, width: number, height: number): Comp[] {
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  type Run = { x0: number; x1: number; label: number };
  const runsByRow: Run[][] = [];
  let prev: Run[] = [];
  for (let y = 0; y < height; y++) {
    const row: Run[] = [];
    const base = y * width;
    let x = 0;
    while (x < width) {
      if (!ink[base + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < width && ink[base + x]) x++;
      const run: Run = { x0, x1: x - 1, label: -1 };
      for (const p of prev) {
        if (p.x0 <= run.x1 + 1 && p.x1 >= run.x0 - 1) {
          if (run.label < 0) run.label = find(p.label);
          else {
            const a = find(run.label);
            const b = find(p.label);
            if (a !== b) parent[b] = a;
          }
        }
      }
      if (run.label < 0) {
        run.label = parent.length;
        parent.push(run.label);
      }
      row.push(run);
    }
    runsByRow.push(row);
    prev = row;
  }
  const comps = new Map<number, Comp>();
  runsByRow.forEach((row, y) => {
    for (const r of row) {
      const root = find(r.label);
      const c = comps.get(root);
      if (c) {
        c.x0 = Math.min(c.x0, r.x0);
        c.x1 = Math.max(c.x1, r.x1 + 1);
        c.y1 = Math.max(c.y1, y + 1);
        c.area += r.x1 - r.x0 + 1;
      } else comps.set(root, { x0: r.x0, x1: r.x1 + 1, y0: y, y1: y + 1, area: r.x1 - r.x0 + 1 });
    }
  });
  return [...comps.values()];
}

/** Long rows of evenly spaced dots (table-of-contents leaders). */
function leaderDots(dots: Comp[], charH: number): Set<Comp> {
  const out = new Set<Comp>();
  const sorted = [...dots].sort((a, b) => a.x0 - b.x0);
  const used = new Set<Comp>();
  for (const d of sorted) {
    if (used.has(d)) continue;
    const chain = [d];
    let last = d;
    for (const e of sorted) {
      if (e.x0 <= last.x0 || used.has(e)) continue;
      if (Math.abs((e.y0 + e.y1) / 2 - (last.y0 + last.y1) / 2) > 0.25 * charH) continue;
      if (e.x0 - last.x1 > 1.2 * charH) continue;
      chain.push(e);
      last = e;
    }
    // Leaders are long and evenly spaced; short runs of tiny glyphs are usually ruby kana.
    const steps = chain.slice(1).map((c, i) => c.x0 - chain[i].x0);
    const mean = steps.reduce((a, b) => a + b, 0) / Math.max(1, steps.length);
    const even = steps.every((st) => Math.abs(st - mean) < 0.2 * mean);
    if (chain.length >= 8 && even) chain.forEach((c) => (out.add(c), used.add(c)));
  }
  return out;
}

const vOverlap = (a: Box, b: Box) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);

/**
 * Finds text lines in a page bitmap. Boxes are returned in the coordinates of
 * the given canvas.
 */
export function detectLines(input: HTMLCanvasElement): DetectedLine[] {
  const k = Math.min(1, ANALYSIS_SIDE / Math.max(input.width, input.height));
  const width = Math.round(input.width * k);
  const height = Math.round(input.height * k);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(input, 0, 0, width, height);
  const d = ctx.getImageData(0, 0, width, height).data;

  const grey = new Uint8Array(width * height);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    grey[p] = g;
    hist[g | 0]++;
  }
  const t = otsu(hist, grey.length);
  const ink = new Uint8Array(grey.length);
  for (let p = 0; p < grey.length; p++) ink[p] = grey[p] < t ? 1 : 0;

  const comps = components(ink, width, height).filter((c) => c.area >= 3);
  if (!comps.length) return [];

  // Typical character height from character-like components.
  const charLike = comps.filter((c) => h(c) >= 4 && h(c) < height * 0.06 && w(c) < 3 * h(c));
  const charH = Math.max(6, percentile(charLike.map(h), 0.75));

  // Illustrations: tall or very large components; anything inside them is drawing, not text.
  const art = comps.filter((c) => h(c) > 4.5 * charH || (w(c) > 10 * charH && h(c) > 2.2 * charH));
  const insideArt = (c: Box) => {
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    return art.some((a) => cx > a.x0 && cx < a.x1 && cy > a.y0 && cy < a.y1);
  };
  const charShaped = (c: Box) => h(c) >= 0.45 * charH && h(c) <= 2.2 * charH && w(c) <= 2.5 * h(c);
  const small = comps.filter((c) => h(c) <= 0.3 * charH && w(c) <= 0.45 * charH);
  const leaders = leaderDots(small, charH);

  const glyphs = comps
    // Inside an illustration only character-shaped pieces survive: lettering in
    // speech bubbles and labels is kept, strokes of the drawing are not.
    .filter((c) => !art.includes(c) && !leaders.has(c) && (!insideArt(c) || charShaped(c)))
    .sort((a, b) => a.x0 - b.x0);

  // Chain glyphs into lines, left to right.
  type Line = Box & { n: number; core: number };
  const lines: Line[] = [];
  for (const g of glyphs) {
    let best: Line | null = null;
    let bestGap = Infinity;
    for (const l of lines) {
      const gap = g.x0 - l.x1;
      if (gap > 1.6 * l.core || gap < -0.5 * l.core) continue;
      const overlap = vOverlap(g, l);
      // Most of a glyph must sit inside the line's band; ruby of the next line
      // brushing the bottom of this one must not be pulled in.
      if (overlap < Math.max(0.45 * Math.min(h(g), l.core), 0.7 * h(g))) continue;
      // Do not let a big glyph swallow a small line (or vice versa) unless it is punctuation.
      if (h(g) > 2.2 * l.core && l.n > 1) continue;
      if (gap < bestGap) {
        best = l;
        bestGap = gap;
      }
    }
    if (best) {
      best.x0 = Math.min(best.x0, g.x0);
      best.x1 = Math.max(best.x1, g.x1);
      best.y0 = Math.min(best.y0, g.y0);
      best.y1 = Math.max(best.y1, g.y1);
      best.n++;
      best.core = Math.max(best.core, Math.min(h(g), 1.5 * best.core));
    } else lines.push({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, n: 1, core: Math.max(h(g), 0.5 * charH) });
  }

  // Merge pieces of one line: words split by wide (full-width) spaces, and
  // stray strokes of a character that sit inside a line's box.
  let merged: Line[] = lines.filter((l) => h(l) >= 0.25 * charH && w(l) >= 0.25 * charH);
  for (let changed = true; changed; ) {
    changed = false;
    merged.sort((a, b) => a.x0 - b.x0);
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = 0; j < merged.length; j++) {
        if (i === j) continue;
        const a = merged[i];
        const b = merged[j];
        const ha = h(a);
        const hb = h(b);
        const ov = vOverlap(a, b);
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const contained = ix > 0.6 * w(b) && ov > 0.6 * hb && hb <= ha;
        const gap = b.x0 - a.x1;
        const sameLine =
          b.x0 >= a.x0 && ov > 0.5 * Math.min(ha, hb) && Math.max(ha, hb) < 1.9 * Math.min(ha, hb) && gap < 1.8 * Math.max(ha, hb);
        // A fragment lying inside a taller line's band beside it (parts of a split
        // character such as 会, a small mark) belongs to that line.
        const dist = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        const inBand = hb < ha && b.y0 >= a.y0 - 0.15 * ha && b.y1 <= a.y1 + 0.15 * ha && dist < 0.8 * ha;
        if (contained || sameLine || inBand) {
          a.x0 = Math.min(a.x0, b.x0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y0 = Math.min(a.y0, b.y0);
          a.y1 = Math.max(a.y1, b.y1);
          a.n += b.n;
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  // Ruby: a short, small line hugging the top of a larger one.
  const ruby = new Set<Line>();
  for (const r of merged) {
    for (const base of merged) {
      if (base === r || h(r) > 0.65 * h(base)) continue;
      const below = base.y0 - r.y1;
      const overlapX = Math.min(base.x1, r.x1) - Math.max(base.x0, r.x0);
      if (below > -0.3 * h(r) && below < Math.max(0.9 * h(r), 0.5 * h(base)) && overlapX > 0.6 * w(r)) {
        ruby.add(r);
        break;
      }
    }
  }

  // A lone glyph inside a drawing is almost always part of the drawing.
  merged = merged.filter((l) => !(l.n < 2 && insideArt(l)));

  // What is neither ruby nor text-sized is a speck.
  const real = merged.filter((l) => ruby.has(l) || (h(l) >= 0.4 * charH && (l.n >= 2 || h(l) >= 0.6 * charH)));

  const s = 1 / k;
  const scale = (b: Box): Box => ({ x0: b.x0 * s, y0: b.y0 * s, x1: b.x1 * s, y1: b.y1 * s });
  const out: DetectedLine[] = real.filter((l) => !ruby.has(l)).map((l) => ({ ...scale(l), ruby: [] }));
  for (const r of ruby) {
    const rb = scale(r);
    const owner = out
      .filter((l) => Math.min(l.x1, rb.x1) - Math.max(l.x0, rb.x0) > 0)
      .sort((a, b) => Math.abs(a.y0 - rb.y1) - Math.abs(b.y0 - rb.y1))[0];
    owner?.ruby.push(rb);
  }
  // Reading order: rows top to bottom (lines whose centres share a band), then left to right.
  const byCentre = out.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const rows: DetectedLine[][] = [];
  for (const l of byCentre) {
    const cy = (l.y0 + l.y1) / 2;
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(cy - (ref.y0 + ref.y1) / 2) < 0.5 * Math.min(ref.y1 - ref.y0, l.y1 - l.y0)) row.push(l);
    else rows.push([l]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x0 - b.x0));
}
