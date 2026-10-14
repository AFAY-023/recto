import { fitText, translatedText } from './layout';
import { guessLangFromText, ocrLangs } from './langs';
import { getCached, hashBytes, putCached } from './ocrcache';
import type { AiReader } from './aiocr';
import type { OcrStage } from './ocr';
import type { Doc, Issue, Mode, ModeChoice, OcrContext, Page, Region } from './types';
import type { Segment, Translator } from './translate';

export const MAX_PAGES = 60;

export async function loadDocument(
  file: Blob,
  name: string,
  onProgress: (done: number, total: number) => void,
): Promise<Doc> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
  // pdf.js is large; load it only once a document is opened.
  const { analyzePdfPage, imageToPage, openPdf } = await import('./pdf');
  if (!isPdf) {
    const page = await imageToPage(file);
    onProgress(1, 1);
    return { name, kind: 'image', pages: [page], imageFile: file, hash: await hashBytes(file) };
  }
  const bytes = await file.arrayBuffer();
  // pdf.js detaches the buffer it reads; keep the original for later OCR renders.
  const pdf = await openPdf(bytes.slice(0));
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const pages: Page[] = [];
  for (let n = 1; n <= total; n++) {
    pages.push(await analyzePdfPage(pdf, n));
    onProgress(n, total);
  }
  await pdf.loadingTask.destroy();
  const langHint = guessLangFromText(pages.flatMap((p) => p.native.map((r) => r.text)).join(' ').slice(0, 20000));
  return { name, kind: 'pdf', pages, pdfData: bytes, langHint, hash: await hashBytes(bytes) };
}

export function resolveMode(page: Page, choice: ModeChoice): Mode {
  if (!page.background) return 'image';
  return choice === 'auto' ? page.recommended : choice;
}

/** Identifies an OCR run: which bitmap (original or text-free) and which languages. */
export function ocrKey(page: Page, mode: Mode, sourceLang: string, ctx: OcrContext, ai?: AiReader | null): string {
  const reader = ai ? `${ai.key}:${sourceLang}` : ocrLangs(sourceLang, ctx.langHint).code;
  return `${mode === 'image' || !page.background ? 'src' : 'bg'}:${reader}`;
}

/** The bitmap OCR reads: re-rendered at high resolution when the original is available. */
async function ocrInput(page: Page, textFree: boolean, ctx: OcrContext): Promise<HTMLCanvasElement> {
  const { renderPdfForOcr, imageForOcr } = await import('./pdf');
  if (ctx.pdfData) return renderPdfForOcr(ctx.pdfData, page.index + 1, textFree);
  if (ctx.imageFile) return imageForOcr(ctx.imageFile);
  return textFree && page.background ? page.background : page.source;
}

/** Builds the region list for a mode, running OCR when the mode needs it. */
export async function prepareRegions(
  page: Page,
  mode: Mode,
  sourceLang: string,
  ctx: OcrContext,
  onOcrProgress?: (stage: OcrStage, p: number) => void,
  ai?: AiReader | null,
  signal?: AbortSignal,
): Promise<{ regions: Region[]; ocr?: Page['ocr'] }> {
  if (mode === 'text') return { regions: carry(page.regions, page.native) };
  const useSource = mode === 'image' || !page.background;
  const key = ocrKey(page, mode, sourceLang, ctx, ai);
  let ocr = page.ocr?.key === key ? page.ocr : undefined;
  if (!ocr) {
    const langs = ocrLangs(sourceLang, ctx.langHint);
    const label = ai ? `AI 识别 · ${ai.label}` : `Tesseract · ${langs.label}`;
    // Bump the version when line detection or reading changes, so stale results are not reused.
    const cacheKey = ctx.hash ? `v3:${ctx.hash}:${page.index}:${key}` : null;
    const cached = cacheKey ? await getCached(cacheKey) : undefined;
    if (cached) {
      ocr = { key, regions: cached, langs: `${label}（已缓存）` };
    } else {
      const input = await ocrInput(page, !useSource, ctx);
      const { ocrPage } = await import('./ocr');
      const regions = await ocrPage(page, input, { langs, sourceLang, ai, signal }, `p${page.index + 1}-${useSource ? 's' : 'b'}`, onOcrProgress);
      if (cacheKey) await putCached(cacheKey, regions);
      ocr = { key, regions, langs: label };
    }
  }
  const next = mode === 'image' ? ocr.regions : [...page.native, ...ocr.regions];
  return { regions: carry(page.regions, next), ocr };
}

/** Keeps translations and user edits when a region list is rebuilt. */
function carry(previous: Region[], next: Region[]): Region[] {
  const old = new Map(previous.map((r) => [r.id, r]));
  return next.map((r) => {
    const o = old.get(r.id);
    return o ? { ...r, translation: o.translation, translate: o.translate, fontScale: o.fontScale, edited: o.edited, text: o.text } : r;
  });
}

export function segmentsToTranslate(regions: Region[], force = false): Segment[] {
  return regions
    .filter((r) => r.translate && !r.rotation && (force || !r.translation))
    .map((r) => ({ id: r.id, text: r.text }));
}

export async function translateRegions(
  regions: Region[],
  translator: Translator,
  opts: Parameters<Translator['translate']>[1],
  only?: Set<string>,
): Promise<Region[]> {
  const segs = segmentsToTranslate(regions, !!only).filter((s) => !only || only.has(s.id));
  if (!segs.length) return regions;
  const result = await translator.translate(segs, opts);
  return regions.map((r) => (result.has(r.id) ? { ...r, translation: result.get(r.id), edited: false } : r));
}

/** A few translated pairs from a page, passed as context to the next page. */
export function contextFrom(page: Page | undefined): Segment[] {
  if (!page) return [];
  return page.regions
    .filter((r) => r.translation && r.text.length < 120)
    .slice(0, 12)
    .map((r) => ({ id: r.text, text: r.translation! }));
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Flags regions whose translation does not fit even at the minimum size. */
export function withOverflow(page: Page, regions: Region[], lang: string): Region[] {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  return regions.map((r) => {
    const text = translatedText(r);
    const overflow = text ? !fitText(ctx, r, text, lang, page.scale).fits : false;
    return overflow === !!r.overflow ? r : { ...r, overflow };
  });
}

/** Static analysis issues plus issues that depend on the current translation. */
export function liveIssues(page: Page): Issue[] {
  const issues = [...page.issues];
  const over = page.regions.filter((r) => r.overflow);
  if (over.length) {
    issues.push({ code: 'overflow', severity: 'warn', message: `${over.length} 段译文放不下原来的位置，已缩到最小字号，请检查或精简。`, regionId: over[0].id });
  }
  const weak = page.regions.filter((r) => r.origin === 'ocr' && (r.confidence ?? 100) < 70);
  if (weak.length) {
    issues.push({ code: 'low_confidence', severity: 'info', message: `${weak.length} 段 OCR 识别置信度较低，建议核对原文。`, regionId: weak[0].id });
  }
  if (page.mode !== 'text' && page.regions.length === 0 && page.status === 'done') {
    issues.push({ code: 'nothing_found', severity: 'info', message: '这一页没有识别到可翻译的文字。' });
  }
  return issues;
}

export function pageChars(page: Page): string[] {
  return page.regions.filter((r) => r.translate && !r.translation).map((r) => r.text);
}
