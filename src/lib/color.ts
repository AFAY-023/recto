export type RGB = [number, number, number];

export function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function luminance([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Collects colors and returns the most common one after 16-level quantisation. */
export class ColorVote {
  private buckets = new Map<number, { n: number; r: number; g: number; b: number }>();

  add(r: number, g: number, b: number) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = this.buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1;
    e.r += r;
    e.g += g;
    e.b += b;
    this.buckets.set(key, e);
  }

  get count() {
    let n = 0;
    this.buckets.forEach((e) => (n += e.n));
    return n;
  }

  winner(): RGB | null {
    let best: { n: number; r: number; g: number; b: number } | null = null;
    this.buckets.forEach((e) => {
      if (!best || e.n > best.n) best = e;
    });
    if (!best) return null;
    const { n, r, g, b } = best;
    return [r / n, g / n, b / n];
  }
}

/** Pixel-space rectangle on an ImageData, clamped. */
function clampRect(img: ImageData, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  return { x0, y0, x1, y1 };
}

/** Dominant color along the inside border of a rectangle (pixel coords). */
export function sampleBorder(img: ImageData, x: number, y: number, w: number, h: number): RGB {
  const { x0, y0, x1, y1 } = clampRect(img, x - 2, y - 2, w + 4, h + 4);
  const vote = new ColorVote();
  const push = (px: number, py: number) => {
    const i = (py * img.width + px) * 4;
    if (img.data[i + 3] === 0) return;
    vote.add(img.data[i], img.data[i + 1], img.data[i + 2]);
  };
  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 12));
  for (let px = x0; px < x1; px += stepX) {
    push(px, y0);
    push(px, Math.max(y0, y1 - 1));
  }
  for (let py = y0; py < y1; py += stepY) {
    push(x0, py);
    push(Math.max(x0, x1 - 1), py);
  }
  return vote.winner() ?? [255, 255, 255];
}

/**
 * Text color inside a rectangle: the dominant color among pixels that differ
 * from `reference` — either a text-free background bitmap (PDF pages) or a
 * flat background color (OCR regions).
 */
export function sampleInk(
  img: ImageData,
  reference: ImageData | RGB,
  x: number,
  y: number,
  w: number,
  h: number,
): RGB | null {
  const { x0, y0, x1, y1 } = clampRect(img, x, y, w, h);
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000)));
  const ink: { r: number; g: number; b: number; l: number }[] = [];
  let refLum = 0;
  let refN = 0;
  for (let py = y0; py < y1; py += step) {
    for (let px = x0; px < x1; px += step) {
      const i = (py * img.width + px) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      let rr: number, rg: number, rb: number;
      if (Array.isArray(reference)) {
        [rr, rg, rb] = reference;
      } else {
        rr = reference.data[i];
        rg = reference.data[i + 1];
        rb = reference.data[i + 2];
      }
      if (Math.abs(r - rr) + Math.abs(g - rg) + Math.abs(b - rb) > 90) {
        ink.push({ r, g, b, l: 0.2126 * r + 0.7152 * g + 0.0722 * b });
        refLum += 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;
        refN++;
      }
    }
  }
  if (ink.length < 3) return null;
  // Anti-aliased stroke edges outnumber the solid core of thin text, so the most
  // common colour comes out grey. Average the quarter of ink pixels furthest
  // from the background instead: darkest on light paper, lightest on dark.
  const darkText = refLum / refN > 128;
  ink.sort((a, b) => (darkText ? a.l - b.l : b.l - a.l));
  const core = ink.slice(0, Math.max(3, Math.ceil(ink.length / 4)));
  const avg = (k: 'r' | 'g' | 'b') => core.reduce((s, p) => s + p[k], 0) / core.length;
  return [avg('r'), avg('g'), avg('b')];
}
