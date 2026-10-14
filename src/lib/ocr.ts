import { createWorker, PSM, type Worker } from 'tesseract.js';
import { sampleBorder, sampleInk, toHex } from './color';
import {
  collapseCjkSpaces,
  isCjk,
  detectAlign,
  joinLines,
  joinPieces,
  median,
  shouldTranslate,
  type Line,
} from './textblock';
import { lineSheets, type AiReader, type LineReading } from './aiocr';
import { detectLines, type DetectedLine } from './lines';
import type { BBox, Page, Region } from './types';

const workers = new Map<string, Promise<Worker>>();

export type OcrStage = 'download' | 'recognize' | 'ai';
type ProgressFn = (stage: OcrStage, p: number) => void;

let progressSink: ProgressFn | undefined;

function getWorker(code: string): Promise<Worker> {
  let w = workers.get(code);
  if (!w) {
    w = createWorker(code, 1, {
      logger: (m) => {
        if (m.status === 'loading language traineddata') progressSink?.('download', m.progress);
        else if (m.status === 'recognizing text') progressSink?.('recognize', m.progress);
      },
    });
    workers.set(code, w);
    w.catch(() => workers.delete(code));
  }
  return w;
}

/** Minimum Tesseract confidence we accept as real text; CJK models score lower. */
const MIN_CONFIDENCE = 55;
const MIN_CONFIDENCE_CJK = 45;

interface Segment extends Line {
  confidence: number;
  /** Extra areas to erase with this line (its ruby), in page units. */
  ruby?: BBox[];
}

/** Filters OCR noise: lone marks and short Latin fragments read off textures. */
function plausible(seg: Segment): boolean {
  const t = seg.text.replace(/\s/g, '');
  if (!t) return false;
  const cjk = [...t].filter((ch) => isCjk(ch)).length;
  if (cjk >= 1 && t.length >= 2) return true;
  // A lone CJK character is usually half of a spaced-out label; merged later.
  if (cjk === 1 && t.length === 1) return seg.confidence >= 70;
  if (cjk === 0 && t.length <= 3) return seg.confidence >= 85 && /^[\p{L}\p{N}]+$/u.test(t);
  return t.length >= 2;
}

const KANA_ONLY = /^[぀-ヿ\s]+$/;

/**
 * Drops ruby (furigana): small kana-only text sitting just above a larger
 * line it annotates. It is a reading aid, not content to translate.
 */
function dropRuby(segs: Segment[]): Segment[] {
  return segs.filter((r) => {
    if (!KANA_ONLY.test(r.text)) return true;
    const h = r.bottom - r.top;
    return !segs.some(
      (base) =>
        base !== r &&
        base.bottom - base.top > 1.5 * h &&
        base.top >= r.top + 0.3 * h &&
        base.top - r.bottom < 1.2 * h &&
        Math.min(base.right, r.right) - Math.max(base.left, r.left) > 0.5 * (r.right - r.left),
    );
  });
}

/**
 * Sparse mode returns many fragments; re-join pieces that share a baseline.
 * Spaced-out CJK labels ("社　　址") are allowed a wider gap.
 */
function mergeLineFragments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  const sorted = [...segs].sort((a, b) => a.left - b.left);
  for (const seg of sorted) {
    const h = seg.bottom - seg.top;
    const prev = out.find((p) => {
      const ph = p.bottom - p.top;
      if (Math.abs(p.top - seg.top) > 0.35 * Math.max(h, ph) || Math.abs(ph - h) > 0.4 * Math.max(h, ph)) return false;
      const gap = seg.left - p.right;
      if (gap < -0.3 * h) return false;
      const spaced =
        [...p.text.replace(/\s/g, '')].length <= 3 &&
        [...seg.text.replace(/\s/g, '')].length <= 2 &&
        isCjk(p.text.trim().slice(-1)) &&
        isCjk(seg.text.trim()[0] ?? '');
      return gap < (spaced ? 3.5 : 1.0) * h;
    });
    if (prev) {
      prev.text = joinPieces(prev.text.trim(), seg.text.trim());
      prev.right = Math.max(prev.right, seg.right);
      prev.top = Math.min(prev.top, seg.top);
      prev.bottom = Math.max(prev.bottom, seg.bottom);
      prev.confidence = Math.min(prev.confidence, seg.confidence);
    } else out.push({ ...seg });
  }
  return out;
}

/** Common OCR slips in Japanese text: the katakana middle dot read as * or •. */
function fixJapanese(text: string): string {
  return text.replace(/(?<=[゠-ヿ])[*•·･・]+(?=[゠-ヿ])/g, '・');
}

/**
 * Greyscale plus a contrast stretch from ink to paper: lifts faint print off
 * tinted or yellowed paper before Tesseract binarises it.
 */
function normalise(input: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = input.width;
  out.height = input.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(input, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    hist[g | 0]++;
  }
  // Paper (the median tone) becomes white and the darkest ink black; noise on the paper is not amplified.
  const total = d.length / 4;
  let lo = 0;
  let paper = 0;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.005; lo++);
  for (let acc = 0; paper < 255 && (acc += hist[paper]) < total * 0.5; paper++);
  if (paper - lo < 60) return input;
  const range = paper - lo;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Splits a Tesseract line into segments at wide word gaps: labels around a
 * figure often land on one "line" although they are separate texts.
 */
function splitLine(words: OcrWord[], scale: number): Segment[] {
  const out: Segment[] = [];
  let cur: OcrWord[] = [];
  const flush = () => {
    const kept = cur.filter((w) => w.text.trim());
    if (kept.length) {
      const x0 = Math.min(...kept.map((w) => w.bbox.x0));
      const x1 = Math.max(...kept.map((w) => w.bbox.x1));
      const y0 = Math.min(...kept.map((w) => w.bbox.y0));
      const y1 = Math.max(...kept.map((w) => w.bbox.y1));
      const text = collapseCjkSpaces(kept.map((w) => w.text).reduce(joinPieces, ''));
      out.push({
        text,
        left: x0 / scale,
        right: x1 / scale,
        top: y0 / scale,
        bottom: y1 / scale,
        // Ink height runs from cap/ascender to baseline (or descender); the em box is larger.
        fontSize: ((y1 - y0) / scale) * 1.1,
        confidence: median(kept.map((w) => w.confidence)),
      });
    }
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const h = Math.max(prev.bbox.y1 - prev.bbox.y0, w.bbox.y1 - w.bbox.y0);
      // Spaced-out CJK labels ("社　　址") keep wide gaps between single characters.
      const spaced = cur.length === 1 && isCjk(prev.text.trim()) && prev.text.trim().length === 1;
      if (w.bbox.x0 - prev.bbox.x1 > (spaced ? 3.2 : 1.4) * h) flush();
    }
    cur.push(w);
  }
  flush();
  return out;
}

const SENTENCE_END = /[。．.!?！？]["'”’)）」』]*$/;

/**
 * Lines → blocks. Only a genuinely wrapped paragraph becomes one block (its
 * lines run to the same right edge and the sentence continues); list items,
 * table-of-contents rows and labels stay one line each, so every translation
 * is typeset exactly where its source line was.
 */
function paragraphs(segs: Segment[]): Segment[][] {
  const blocks: Segment[][] = [];
  for (const seg of [...segs].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const hs = seg.bottom - seg.top;
    const block = blocks.find((b) => {
      const last = b[b.length - 1];
      const hl = last.bottom - last.top;
      const width = Math.max(...b.map((l) => l.right)) - Math.min(...b.map((l) => l.left));
      return (
        Math.abs(hl - hs) < 0.3 * Math.max(hl, hs) &&
        Math.abs(last.left - seg.left) < 0.8 * hl &&
        seg.top - last.bottom < 0.9 * hl &&
        seg.top > last.top &&
        last.right - last.left > 0.85 * Math.max(width, seg.right - seg.left) &&
        !SENTENCE_END.test(last.text.trim())
      );
    });
    if (block) block.push(seg);
    else blocks.push([seg]);
  }
  return blocks;
}

const overlapArea = (a: Line, b: Line) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Segments → regions: colours, erase masks (line boxes plus their ruby), font size. */
function buildRegions(segments: Segment[], input: HTMLCanvasElement, page: Page, idPrefix: string): Region[] {
  const s = input.width / page.width;
  const img = input.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, input.width, input.height);
  const regions: Region[] = [];
  for (const b of paragraphs(segments)) {
    const text = fixJapanese(collapseCjkSpaces(joinLines(b)));
    if (!shouldTranslate(text)) continue;
    const left = Math.min(...b.map((l) => l.left));
    const right = Math.max(...b.map((l) => l.right));
    const top = Math.min(...b.map((l) => l.top));
    const bottom = Math.max(...b.map((l) => l.bottom));
    const px = { x: left * s, y: top * s, w: (right - left) * s, h: (bottom - top) * s };
    const bg = sampleBorder(img, px.x, px.y, px.w, px.h);
    const ink = sampleInk(img, bg, px.x, px.y, px.w, px.h);
    const fontSize = median(b.map((l) => l.fontSize));
    const pad = 0.12 * fontSize;
    const pitches = b.slice(1).map((l, i) => l.top - b[i].top);
    regions.push({
      id: `${idPrefix}-o${regions.length + 1}`,
      origin: 'ocr',
      text,
      bbox: { x: left - pad, y: top - pad, w: right - left + 2 * pad, h: bottom - top + 2 * pad },
      masks: [...b.map((l) => ({ x: l.left, y: l.top, w: l.right - l.left, h: l.bottom - l.top })), ...b.flatMap((l) => l.ruby ?? [])],
      fontSize,
      lineHeight: pitches.length ? Math.min(1.8, Math.max(1.0, median(pitches) / fontSize)) : 1.2,
      bold: false,
      italic: false,
      fontCategory: 'sans',
      color: ink ? toHex(ink) : '#111111',
      background: toHex(bg),
      align: detectAlign(b, page.width),
      rotation: 0,
      translate: true,
      fontScale: 1,
      confidence: median(b.map((l) => l.confidence)),
    });
  }
  return regions;
}

/**
 * AI reading: every detected line is cropped onto numbered line sheets and a
 * vision model transcribes each row. Positions come from the line
 * detector, so nothing is skipped and every translation lands on its line.
 */
async function readWithAi(
  page: Page,
  input: HTMLCanvasElement,
  detected: DetectedLine[],
  ai: AiReader,
  ocr: { sourceLang: string; signal?: AbortSignal },
  idPrefix: string,
  onProgress?: ProgressFn,
): Promise<Region[]> {
  const s = input.width / page.width;
  const tiles = lineSheets(input, detected);
  const readings = new Map<number, LineReading>();
  for (const [i, tile] of tiles.entries()) {
    onProgress?.('ai', i / tiles.length);
    const part = await ai.read(tile.base64, tile.numbers, ocr);
    part.forEach((v, k) => readings.set(k, v));
  }
  onProgress?.('ai', 1);
  const segments: Segment[] = [];
  detected.forEach((line, i) => {
    const r = readings.get(i + 1);
    if (!r || r.kind !== 'text' || !r.text) return;
    const lh = (line.y1 - line.y0) / s;
    segments.push({
      text: r.text,
      left: line.x0 / s,
      right: line.x1 / s,
      top: line.y0 / s,
      bottom: line.y1 / s,
      // Ink height of a CJK line is ~0.9 em; Latin lines include ascenders and descenders.
      fontSize: lh * 1.05,
      confidence: 100,
      ruby: line.ruby.map((b) => ({ x: b.x0 / s, y: b.y0 / s, w: (b.x1 - b.x0) / s, h: (b.y1 - b.y0) / s })),
    });
  });
  return buildRegions(segments, input, page, idPrefix);
}

export interface OcrOptions {
  langs: { code: string; cjk: boolean };
  sourceLang: string;
  /** When set, a vision model reads the lines instead of Tesseract. */
  ai?: AiReader | null;
  signal?: AbortSignal;
}

/**
 * Finds text in a page bitmap. With AI reading on, lines are located by
 * image analysis and transcribed by a vision model. Otherwise Tesseract
 * reads the page in sparse mode. For PDF pages in smart mode the input is the
 * text-free background, so only text baked into images is found.
 */
export async function ocrPage(
  page: Page,
  input: HTMLCanvasElement,
  opts: OcrOptions,
  idPrefix: string,
  onProgress?: ProgressFn,
): Promise<Region[]> {
  // Line finding and the AI's view use the page as scanned: contrast stretching
  // helps Tesseract but breaks thin, resampled strokes into fragments.
  const detected = detectLines(input);
  if (opts.ai) {
    return readWithAi(page, input, detected, opts.ai, { sourceLang: opts.sourceLang, signal: opts.signal }, idPrefix, onProgress);
  }
  const norm = normalise(input);

  const s = input.width / page.width;
  const minConfidence = opts.langs.cjk ? MIN_CONFIDENCE_CJK : MIN_CONFIDENCE;
  progressSink = onProgress;
  let data;
  try {
    const worker = await getWorker(opts.langs.code);
    // Sparse mode finds scattered short text (labels, credits, callouts); paragraphs are rebuilt below.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    ({ data } = await worker.recognize(norm, {}, { blocks: true }));
  } finally {
    progressSink = undefined;
  }

  // Ruby found by the line detector is erased with its line but never read as text.
  const rubyBoxes: Line[] = detected.flatMap((l) =>
    l.ruby.map((r) => ({ text: '', left: r.x0 / s, right: r.x1 / s, top: r.y0 / s, bottom: r.y1 / s, fontSize: 0 })),
  );
  const segments: Segment[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const seg of splitLine(line.words, s)) {
          if (seg.confidence < minConfidence || !plausible(seg)) continue;
          const area = (seg.right - seg.left) * (seg.bottom - seg.top);
          if (rubyBoxes.some((c) => overlapArea(c, seg) > 0.3 * area)) continue;
          segments.push(seg);
        }
      }
    }
  }
  return buildRegions(mergeLineFragments(dropRuby(segments)), input, page, idPrefix);
}
