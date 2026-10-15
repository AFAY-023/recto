/**
 * Live figures for the technical notes, computed with the same modules the app
 * uses: the bundled sample manual and a synthetic scanned page.
 */
import { loadDocument, prepareRegions, translateRegions } from '../lib/pipeline';
import { renderTranslated } from '../lib/layout';
import { DemoTranslator } from '../lib/translate';
import { detectLines } from '../lib/lines';
import { lineSheets } from '../lib/aiocr';
import sampleDict from '../lib/sample-dict.json';
import { drawSpecimen, specimenFontsReady } from './specimen';

export interface SampleFigures {
  original: string;
  textFree: string;
  textLayer: string;
  translated: string;
  regions: number;
}

export interface ScanFigures {
  boxes: string;
  sheet: string;
  lines: number;
  ruby: number;
  ms: number;
}

const url = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.86);

function copy(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

export async function sampleFigures(): Promise<SampleFigures> {
  const res = await fetch(`${import.meta.env.BASE_URL}sample/aquabrew-sk200-manual.pdf`);
  const doc = await loadDocument(await res.blob(), 'aquabrew-sk200-manual.pdf', () => {});
  const page = doc.pages[0];
  const { regions } = await prepareRegions(page, 'text', 'en', { langHint: doc.langHint });

  // Text-layer boxes drawn over the page, as the app sees them.
  const boxes = copy(page.source);
  const bx = boxes.getContext('2d')!;
  bx.lineWidth = Math.max(2, page.scale * 1.2);
  for (const r of regions) {
    bx.strokeStyle = 'rgb(40 63 125 / 0.9)';
    bx.fillStyle = 'rgb(40 63 125 / 0.08)';
    const s = page.scale;
    bx.fillRect(r.bbox.x * s, r.bbox.y * s, r.bbox.w * s, r.bbox.h * s);
    bx.strokeRect(r.bbox.x * s, r.bbox.y * s, r.bbox.w * s, r.bbox.h * s);
  }

  page.regions = await translateRegions(regions, new DemoTranslator(sampleDict as Record<string, string>), {
    sourceLang: 'en',
    targetLang: 'zh-CN',
    glossary: '',
    context: [],
  });
  const { canvas } = renderTranslated(page, 'zh-CN');
  return {
    original: url(page.source),
    textFree: url(page.background ?? page.source),
    textLayer: url(boxes),
    translated: url(canvas),
    regions: regions.length,
  };
}

export async function scanFigures(): Promise<ScanFigures> {
  await specimenFontsReady();
  const page = drawSpecimen();
  const t0 = performance.now();
  const lines = detectLines(page);
  const ms = Math.round(performance.now() - t0);

  const boxes = copy(page);
  const x = boxes.getContext('2d')!;
  x.lineWidth = 3;
  x.font = 'bold 18px "Geist Mono", monospace';
  lines.forEach((l, i) => {
    x.strokeStyle = '#283f7d';
    x.strokeRect(l.x0 - 4, l.y0 - 4, l.x1 - l.x0 + 8, l.y1 - l.y0 + 8);
    x.fillStyle = '#283f7d';
    x.fillText(String(i + 1), l.x0 - 30, l.y1);
    x.strokeStyle = '#ec633d';
    for (const r of l.ruby) x.strokeRect(r.x0 - 2, r.y0 - 2, r.x1 - r.x0 + 4, r.y1 - r.y0 + 4);
  });

  const [sheet] = lineSheets(page, lines);
  return {
    boxes: boxes.toDataURL('image/png'),
    sheet: `data:image/jpeg;base64,${sheet.base64}`,
    lines: lines.length,
    ruby: lines.reduce((a, l) => a + l.ruby.length, 0),
    ms,
  };
}
