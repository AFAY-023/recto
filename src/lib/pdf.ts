import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { sampleBorder, sampleInk, toHex } from './color';
import {
  detectAlign,
  blockLineHeight,
  groupLines,
  hasControlChars,
  joinLines,
  joinPieces,
  median,
  shouldTranslate,
  type Line,
} from './textblock';
import type { Classification, FontCategory, Issue, Mode, Page, Region } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const { OPS } = pdfjs;
/** Operators that paint glyphs. Skipping them yields a text-free page. */
const TEXT_OPS = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);

/** Longest bitmap side we render to; keeps memory bounded on large pages. */
const MAX_BITMAP_SIDE = 2600;

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
}

interface Fragment {
  text: string;
  x: number;
  top: number;
  baseline: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  category: FontCategory;
  rotation: number;
}

interface FontInfo {
  bold: boolean;
  italic: boolean;
  category: FontCategory;
}

function fontInfo(page: PDFPageProxy, fontName: string, style: TextStyle | undefined): FontInfo {
  let name = '';
  let bold = false;
  let italic = false;
  let mono = style?.fontFamily === 'monospace';
  let serif = style?.fontFamily === 'serif';
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as {
        name?: string;
        bold?: boolean;
        italic?: boolean;
        black?: boolean;
        isMonospace?: boolean;
        isSerifFont?: boolean;
      };
      name = font.name ?? '';
      bold = !!(font.bold || font.black);
      italic = !!font.italic;
      mono = mono || !!font.isMonospace;
      serif = serif || !!font.isSerifFont;
    }
  } catch {
    // Font not resolved yet; fall back to the name heuristics below.
  }
  if (/bold|black|heavy|semibold|demi/i.test(name)) bold = true;
  if (/italic|oblique/i.test(name)) italic = true;
  if (/courier|mono|consol/i.test(name)) mono = true;
  if (/times|georgia|garamond|minion|serif|song|ming/i.test(name) && !/sans/i.test(name)) serif = true;
  return { bold, italic, category: mono ? 'mono' : serif ? 'serif' : 'sans' };
}

function toFragments(page: PDFPageProxy, items: TextItem[], styles: Record<string, TextStyle>, viewportTransform: number[]): Fragment[] {
  const out: Fragment[] = [];
  const fonts = new Map<string, FontInfo>();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const tx = pdfjs.Util.transform(viewportTransform, item.transform);
    const fontSize = Math.hypot(tx[2], tx[3]);
    if (fontSize < 1) continue;
    const rotation = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;
    const style = styles[item.fontName];
    const ascent = style?.ascent && style.ascent > 0.3 ? style.ascent : 0.8;
    let info = fonts.get(item.fontName);
    if (!info) {
      info = fontInfo(page, item.fontName, style);
      fonts.set(item.fontName, info);
    }
    out.push({
      text: item.str,
      x: tx[4],
      baseline: tx[5],
      top: tx[5] - fontSize * ascent,
      width: item.width,
      fontSize,
      rotation,
      ...info,
    });
  }
  return out;
}

interface LineWithStyle extends Line {
  bold: boolean;
  italic: boolean;
  category: FontCategory;
}

/** Fragments → lines: same baseline band, split at wide gaps (columns, table cells). */
function buildLines(frags: Fragment[]): LineWithStyle[] {
  const sorted = [...frags].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const bands: Fragment[][] = [];
  for (const f of sorted) {
    const band = bands[bands.length - 1];
    if (band && Math.abs(band[0].baseline - f.baseline) < 0.35 * Math.max(band[0].fontSize, f.fontSize)) band.push(f);
    else bands.push([f]);
  }
  const lines: LineWithStyle[] = [];
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    let cur: Fragment[] = [];
    const flush = () => {
      if (!cur.length) return;
      let text = '';
      let right = -Infinity;
      for (const f of cur) {
        const gap = f.x - right;
        text = right > -Infinity && gap > 0.25 * f.fontSize ? joinPieces(text, f.text) : text + f.text;
        right = Math.max(right, f.x + f.width);
      }
      const fs = median(cur.map((f) => f.fontSize));
      const boldShare = cur.filter((f) => f.bold).length / cur.length;
      lines.push({
        text: text.replace(/\s+/g, ' '),
        left: cur[0].x,
        right,
        top: Math.min(...cur.map((f) => f.top)),
        bottom: Math.max(...cur.map((f) => f.baseline + f.fontSize * 0.22)),
        fontSize: fs,
        bold: boldShare > 0.5,
        italic: cur.filter((f) => f.italic).length / cur.length > 0.5,
        category: cur[0].category,
      });
      cur = [];
    };
    for (const f of band) {
      const prev = cur[cur.length - 1];
      if (prev) {
        const gap = f.x - (prev.x + prev.width);
        const sizeJump = Math.abs(f.fontSize - prev.fontSize) > 0.35 * Math.max(f.fontSize, prev.fontSize);
        const fs = Math.max(prev.fontSize, f.fontSize);
        // A short marker (step number, bullet) set apart from its text stays its own piece.
        const marker = gap > 0.8 * fs && cur.map((c) => c.text).join('').trim().length <= 3;
        if (gap > 1.6 * fs || sizeJump || marker) flush();
      }
      cur.push(f);
    }
    flush();
  }
  return lines;
}

async function renderTo(page: PDFPageProxy, scale: number, textFree: boolean): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    operationsFilter: textFree ? (i, list) => !TEXT_OPS.has(list.fnArray[i]) : undefined,
  }).promise;
  return canvas;
}

function classify(nativeChars: number, regionCount: number, rotated: number): Classification {
  if (nativeChars < 20) return 'no_text';
  if (regionCount > 80 || rotated > 0) return 'complex';
  if (nativeChars >= 80) return 'native';
  return 'sparse';
}

/**
 * Reads one PDF page: renders it twice (as-is and with glyph operators
 * filtered out), extracts text blocks with their styling, and classifies it.
 */
export async function analyzePdfPage(doc: PDFDocumentProxy, pageNumber: number): Promise<Page> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_BITMAP_SIDE / Math.max(base.width, base.height));

  const source = await renderTo(page, scale, false);
  const background = await renderTo(page, scale, true);
  const opList = await page.getOperatorList();
  const hasImages = opList.fnArray.some((fn) => IMAGE_OPS.has(fn));

  const content = await page.getTextContent();
  const items = content.items.filter((it): it is TextItem => 'str' in it);
  const frags = toFragments(page, items, content.styles, base.transform);
  const upright = frags.filter((f) => Math.abs(f.rotation) <= 0.5);
  const rotated = frags.filter((f) => Math.abs(f.rotation) > 0.5);
  const blocks = groupLines(buildLines(upright), (b, line) => b.lines[0].bold === line.bold);

  const srcImg = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
  const bgImg = background.getContext('2d')!.getImageData(0, 0, background.width, background.height);

  const regions: Region[] = blocks.map((b, i) => {
    const text = joinLines(b.lines);
    const pad = 0.12 * b.fontSize;
    const bbox = { x: b.left - pad, y: b.top - pad, w: b.right - b.left + 2 * pad, h: b.bottom - b.top + 2 * pad };
    const px = { x: b.left * scale, y: b.top * scale, w: (b.right - b.left) * scale, h: (b.bottom - b.top) * scale };
    const bg = sampleBorder(bgImg, px.x, px.y, px.w, px.h);
    const ink = sampleInk(srcImg, bgImg, px.x, px.y, px.w, px.h);
    return {
      id: `p${pageNumber}-r${i + 1}`,
      origin: 'pdf',
      text,
      bbox,
      fontSize: b.fontSize,
      lineHeight: blockLineHeight(b),
      bold: b.lines[0].bold,
      italic: b.lines[0].italic,
      fontCategory: b.lines[0].category,
      color: ink ? toHex(ink) : '#111111',
      background: toHex(bg),
      align: detectAlign(b.lines, base.width),
      rotation: 0,
      translate: shouldTranslate(text),
      fontScale: 1,
    };
  });

  const nativeChars = regions.reduce((n, r) => n + r.text.length, 0);
  const classification = classify(nativeChars, regions.length, rotated.length);
  const recommended: Mode = classification === 'no_text' ? 'image' : hasImages ? 'smart' : 'text';

  const issues: Issue[] = [];
  if (classification === 'no_text') {
    issues.push({ code: 'no_text_layer', severity: 'warn', message: '这一页几乎没有可提取的文字，可能是扫描件，建议用图片模式。' });
  }
  const broken = regions.filter((r) => hasControlChars(r.text));
  if (broken.length) {
    issues.push({ code: 'broken_encoding', severity: 'block', message: `${broken.length} 段文字含有乱码字符，PDF 的字体编码可能已损坏，建议改用图片模式。` });
  }
  if (rotated.length) {
    issues.push({ code: 'rotated_text', severity: 'warn', message: `有 ${rotated.length} 处旋转或竖排文字，暂不支持，会保留原文。` });
  }
  if (classification === 'complex') {
    issues.push({ code: 'complex_layout', severity: 'info', message: '版面较复杂，翻译后请重点检查。' });
  }

  page.cleanup();
  return {
    index: pageNumber - 1,
    width: base.width,
    height: base.height,
    scale,
    source,
    background,
    regions,
    native: regions,
    nativeChars,
    classification,
    recommended,
    mode: recommended,
    status: 'ready',
    issues,
    revision: 0,
  };
}

/** Longest side of the bitmap handed to OCR: about 300 dpi for an A4 page. */
const OCR_LONG_SIDE = 3500;

let ocrDoc: { data: ArrayBuffer; pdf: Promise<PDFDocumentProxy> } | null = null;

/**
 * Re-renders a PDF page at OCR resolution. The preview bitmap (~140 dpi) is
 * too coarse for small print such as imprint pages and footnotes.
 */
export async function renderPdfForOcr(data: ArrayBuffer, pageNumber: number, textFree: boolean): Promise<HTMLCanvasElement> {
  if (!ocrDoc || ocrDoc.data !== data) {
    void ocrDoc?.pdf.then((d) => d.loadingTask.destroy());
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    ocrDoc = { data, pdf: openPdf(data.slice(0)) };
  }
  const pdf = await ocrDoc.pdf;
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4.5, OCR_LONG_SIDE / Math.max(base.width, base.height));
  const canvas = await renderTo(page, scale, textFree);
  page.cleanup();
  return canvas;
}

/** An image at OCR resolution: small screenshots are enlarged, huge photos reduced. */
export async function imageForOcr(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  let ratio = long < 2400 ? Math.min(3, 2400 / long) : Math.min(1, OCR_LONG_SIDE / long);
  // Resampling softens strokes; skip it when the size is already close.
  if (ratio > 0.9 && ratio < 1.1) ratio = 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Wraps a raster image (photo, screenshot, scan) as a single page. */
export async function imageToPage(file: Blob): Promise<Page> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_BITMAP_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    index: 0,
    width: canvas.width,
    height: canvas.height,
    scale: 1,
    source: canvas,
    background: null,
    regions: [],
    native: [],
    nativeChars: 0,
    classification: 'image',
    recommended: 'image',
    mode: 'image',
    status: 'ready',
    issues: [],
    revision: 0,
  };
}
