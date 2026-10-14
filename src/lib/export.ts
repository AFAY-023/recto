import { PDFDocument } from 'pdf-lib';
import { renderTranslated } from './layout';
import type { Doc, Page } from './types';

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), type, quality),
  );
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Image-based PDF: each page is the composed translated bitmap at the page's
 * original size, so layout matches the source exactly. Text is not selectable.
 */
export async function exportPdf(doc: Doc, lang: string, onProgress?: (done: number) => void): Promise<Blob> {
  const pdf = await PDFDocument.create();
  for (const [i, page] of doc.pages.entries()) {
    const { canvas } = renderTranslated(page, lang);
    const bytes = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
    const img = await pdf.embedJpg(bytes);
    // Image pages are measured in pixels; map them to 72 dpi points at 96 dpi.
    const unit = doc.kind === 'pdf' ? 1 : 0.75;
    const p = pdf.addPage([page.width * unit, page.height * unit]);
    p.drawImage(img, { x: 0, y: 0, width: page.width * unit, height: page.height * unit });
    onProgress?.(i + 1);
    await new Promise((r) => setTimeout(r, 0));
  }
  pdf.setTitle(`${baseName(doc.name)} (${lang})`);
  pdf.setProducer('Recto');
  const bytes = await pdf.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
}

export async function exportPng(page: Page, lang: string): Promise<Blob> {
  const { canvas } = renderTranslated(page, lang);
  return canvasToBlob(canvas, 'image/png');
}

export function exportName(doc: Doc, lang: string, ext: string, pageNo?: number): string {
  return `${baseName(doc.name)}.${lang}${pageNo ? `.p${pageNo}` : ''}.${ext}`;
}
