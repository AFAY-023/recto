import { fontStack } from './langs';
import type { Page, Region } from './types';

interface Token {
  text: string;
  /** Whether a space follows this token. */
  space: boolean;
}

const CLOSING = /^[,.;:!?%)\]}»”’、。，．；：！？）】」』〉》…]+$/;

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    s = new Intl.Segmenter(lang, { granularity: 'word' });
    segmenters.set(lang, s);
  }
  return s;
}

/** Splits a paragraph into breakable units, keeping punctuation off line starts. */
function tokenize(par: string, lang: string): Token[] {
  const tokens: Token[] = [];
  for (const { segment } of segmenter(lang).segment(par)) {
    if (/^\s+$/.test(segment)) {
      if (tokens.length) tokens[tokens.length - 1].space = true;
      continue;
    }
    const prev = tokens[tokens.length - 1];
    if (prev && !prev.space && CLOSING.test(segment)) prev.text += segment;
    else tokens.push({ text: segment, space: false });
  }
  return tokens;
}

interface LaidLine {
  tokens: Token[];
  width: number;
  /** Last line of its paragraph (never justified). */
  last: boolean;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, lang: string, maxWidth: number): LaidLine[] {
  const spaceW = ctx.measureText(' ').width;
  const lines: LaidLine[] = [];
  for (const par of text.split('\n')) {
    const tokens = tokenize(par.trim(), lang);
    let cur: Token[] = [];
    let width = 0;
    const push = (last: boolean) => {
      lines.push({ tokens: cur, width, last });
      cur = [];
      width = 0;
    };
    for (const tok of tokens) {
      let w = ctx.measureText(tok.text).width;
      // A single word wider than the box: break it by characters.
      if (w > maxWidth && [...tok.text].length > 1) {
        for (const ch of [...tok.text]) {
          const cw = ctx.measureText(ch).width;
          if (cur.length && width + cw > maxWidth) push(false);
          cur.push({ text: ch, space: false });
          width += cw;
        }
        if (tok.space && cur.length) cur[cur.length - 1].space = true;
        continue;
      }
      const gap = cur.length && cur[cur.length - 1].space ? spaceW : 0;
      if (cur.length && width + gap + w > maxWidth) {
        push(false);
        w = ctx.measureText(tok.text).width;
        cur.push(tok);
        width = w;
      } else {
        cur.push(tok);
        width += gap + w;
      }
    }
    push(true);
  }
  return lines;
}

function fontString(r: Region, sizePx: number, lang: string): string {
  return `${r.italic ? 'italic ' : ''}${r.bold ? '700 ' : '400 '}${sizePx.toFixed(2)}px ${fontStack(lang, r.fontCategory)}`;
}

export interface Fit {
  size: number;
  lines: LaidLine[];
  lineHeight: number;
  padX: number;
  padY: number;
  fits: boolean;
}

/** Largest font size (shrinking from the source size) at which the text fits its box. */
export function fitText(ctx: CanvasRenderingContext2D, r: Region, text: string, lang: string, scale: number): Fit {
  const boxW = r.bbox.w * scale;
  const boxH = r.bbox.h * scale;
  const start = r.fontSize * scale * r.fontScale;
  const min = start * 0.5;
  let size = start;
  for (;;) {
    ctx.font = fontString(r, size, lang);
    const padX = Math.min(0.06 * size, boxW * 0.04);
    const padY = Math.min(0.04 * size, boxH * 0.05);
    const lineHeight = size * r.lineHeight;
    const lines = wrap(ctx, text, lang, Math.max(1, boxW - 2 * padX));
    // Last line only needs the glyph height, not a full line pitch.
    const height = (lines.length - 1) * lineHeight + size * 1.05;
    const fits = height <= boxH - 2 * padY + 0.5 && lines.every((l) => l.width <= boxW - 2 * padX + 0.5);
    if (fits || size * 0.94 < min) return { size, lines, lineHeight, padX, padY, fits };
    size *= 0.94;
  }
}

function drawRegion(ctx: CanvasRenderingContext2D, r: Region, fit: Fit, lang: string, scale: number) {
  const x = r.bbox.x * scale;
  const y = r.bbox.y * scale;
  const w = r.bbox.w * scale;
  const h = r.bbox.h * scale;
  ctx.font = fontString(r, fit.size, lang);
  ctx.fillStyle = r.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const spaceW = ctx.measureText(' ').width;
  const textH = fit.lines.length * fit.lineHeight;
  const multi = fit.lines.length > 1 || r.text.includes('\n');
  let top = multi ? y + fit.padY : y + (h - textH) / 2;
  if (!fit.fits) top = y + fit.padY;
  const innerW = w - 2 * fit.padX;

  for (const line of fit.lines) {
    const mid = top + fit.lineHeight / 2;
    let cx = x + fit.padX;
    if (r.align === 'center') cx += (innerW - line.width) / 2;
    else if (r.align === 'right') cx += innerW - line.width;

    const extra = line.tokens.length - 1;
    const slack = innerW - line.width;
    const justify = r.align === 'justify' && !line.last && extra > 0 && slack > 0 && slack / extra < fit.size * 1.2;
    if (!justify) {
      ctx.fillText(line.tokens.map((t, i) => t.text + (t.space && i < line.tokens.length - 1 ? ' ' : '')).join(''), cx, mid);
    } else {
      const add = slack / extra;
      for (const t of line.tokens) {
        ctx.fillText(t.text, cx, mid);
        cx += ctx.measureText(t.text).width + (t.space ? spaceW : 0) + add;
      }
    }
    top += fit.lineHeight;
  }
}

/**
 * Covers a rectangle with the surrounding paper: its colour and grain are
 * measured on the strips just above and below, so a scanned page does not show
 * flat patches where text was removed.
 */
function fillLikePaper(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fallback: string,
) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(source.width, Math.ceil(x + w));
  const y1 = Math.min(source.height, Math.ceil(y + h));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return;
  const band = 4;
  const sctx = source.getContext('2d', { willReadFrequently: true })!;
  const samples: number[][] = [[], [], []];
  for (const by of [Math.max(0, y0 - band), Math.min(source.height - band, y1)]) {
    const d = sctx.getImageData(x0, by, width, band).data;
    for (let i = 0; i < d.length; i += 4) {
      samples[0].push(d[i]);
      samples[1].push(d[i + 1]);
      samples[2].push(d[i + 2]);
    }
  }
  const stats = samples.map((ch) => {
    const sorted = [...ch].sort((a, b) => a - b);
    // Upper half only: ignores ink that touches the strips.
    const paper = sorted.slice(sorted.length >> 1);
    const mean = paper.reduce((a, b) => a + b, 0) / Math.max(1, paper.length);
    const sd = Math.sqrt(paper.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, paper.length));
    return { mean, sd: Math.min(sd, 14) };
  });
  if (!samples[0].length || Number.isNaN(stats[0].mean)) {
    ctx.fillStyle = fallback;
    ctx.fillRect(x0, y0, width, height);
    return;
  }
  const img = ctx.createImageData(width, height);
  // Deterministic noise so re-renders look identical.
  let seed = ((((x0 * 73856093) ^ (y0 * 19349663)) >>> 0) % 2147483646) + 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < img.data.length; i += 4) {
    const n = rnd() * 2;
    img.data[i] = stats[0].mean + n * stats[0].sd;
    img.data[i + 1] = stats[1].mean + n * stats[1].sd;
    img.data[i + 2] = stats[2].mean + n * stats[2].sd;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

export function translatedText(r: Region): string | null {
  if (!r.translate || r.rotation) return null;
  const t = r.translation?.trim();
  return t ? t : null;
}

export interface RenderResult {
  canvas: HTMLCanvasElement;
  overflow: Set<string>;
}

/**
 * Composes the translated page: original bitmap, then for every translated
 * region the original text is removed (PDF: copied back from the text-free
 * render; OCR: filled with the sampled background) and the translation is
 * typeset into the same box.
 */
export function renderTranslated(page: Page, lang: string, target?: HTMLCanvasElement): RenderResult {
  const canvas = target ?? document.createElement('canvas');
  canvas.width = page.source.width;
  canvas.height = page.source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(page.source, 0, 0);
  const s = page.scale;
  const overflow = new Set<string>();

  for (const r of page.regions) {
    if (!translatedText(r)) continue;
    const pad = Math.max(1, 0.1 * r.fontSize);
    const ex = (r.bbox.x - pad) * s;
    const ey = (r.bbox.y - pad) * s;
    const ew = (r.bbox.w + 2 * pad) * s;
    const eh = (r.bbox.h + 2 * pad) * s;
    if (r.origin === 'pdf' && page.background) {
      ctx.drawImage(page.background, ex, ey, ew, eh, ex, ey, ew, eh);
    } else {
      for (const m of r.masks ?? [r.bbox]) {
        const mp = 0.15 * r.fontSize;
        fillLikePaper(ctx, page.source, (m.x - mp) * s, (m.y - mp) * s, (m.w + 2 * mp) * s, (m.h + 2 * mp) * s, r.background);
      }
    }
  }
  for (const r of page.regions) {
    const text = translatedText(r);
    if (!text) continue;
    const fit = fitText(ctx, r, text, lang, s);
    if (!fit.fits) overflow.add(r.id);
    drawRegion(ctx, r, fit, lang, s);
  }
  return { canvas, overflow };
}
