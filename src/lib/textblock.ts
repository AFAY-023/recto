import type { Align } from './types';

/** One visual line of text, in page units. */
export interface Line {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  fontSize: number;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯　-〿＀-￯]/;
const LIST_START = /^\s*([•·▪●○■□◆◇►▶✓✔\-–—*]|\d{1,3}[.)、]|[a-zA-Z][.)]|\(\d{1,3}\)|[①-⑳])\s*/;
const SENTENCE_END = /[.!?:;。！？：；]["'”’)）]*$/;

export function isCjk(ch: string): boolean {
  return CJK.test(ch);
}

export function median(values: number[], fallback = 0): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** Joins two text pieces, inserting a space unless either side is CJK. */
export function joinPieces(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  if (isCjk(a[a.length - 1]) || isCjk(b[0])) return a + b;
  return `${a} ${b}`;
}

/** Removes the spaces OCR puts between CJK characters. */
export function collapseCjkSpaces(text: string): string {
  // Spaces only; line breaks between items must survive.
  return text.replace(/([぀-ヿ㐀-鿿＀-￯，。、；：！？）」』])[ 	　]+(?=[぀-ヿ㐀-鿿＀-￯（「『])/g, '$1');
}

/**
 * Turns lines into block text: wrapped lines become one paragraph, while list
 * items and lines that end a sentence early keep a hard break ("\n").
 */
export function joinLines(lines: Line[]): string {
  if (!lines.length) return '';
  const blockWidth = Math.max(...lines.map((l) => l.right)) - Math.min(...lines.map((l) => l.left));
  let out = lines[0].text.trim();
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i].text.trim();
    const prevWidth = prev.right - prev.left;
    const prevText = prev.text.trim();
    // Short CJK lines stacked in a column are separate items (a form, a credits list).
    const cjkItem = prevText.length <= 10 && !/[A-Za-z]{2}/.test(prevText) && [...prevText].some(isCjk);
    const hard =
      cjkItem ||
      LIST_START.test(cur) ||
      prevWidth < 0.6 * blockWidth ||
      (SENTENCE_END.test(prev.text.trim()) && (prevWidth < 0.85 * blockWidth || /^[\p{Lu}\p{N}\p{Lo}]/u.test(cur)));
    if (hard) {
      out += '\n' + cur;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(cur)) {
      out = out.slice(0, -1) + cur;
    } else {
      out = joinPieces(out, cur);
    }
  }
  return out;
}

/** Infers paragraph alignment from the line edges. */
export function detectAlign(lines: Line[], pageWidth: number): Align {
  const fs = median(lines.map((l) => l.fontSize), 10);
  const tol = Math.max(2, 0.45 * fs);
  if (lines.length === 1) {
    const l = lines[0];
    const center = (l.left + l.right) / 2;
    if (Math.abs(center - pageWidth / 2) < Math.max(12, 0.03 * pageWidth) && l.left > 0.15 * pageWidth) return 'center';
    if (l.left > 0.55 * pageWidth) return 'right';
    return 'left';
  }
  // Ignore a first-line indent when judging the left edge.
  const lefts = lines.map((l) => l.left);
  const leftsNoIndent = lines.length >= 3 && lefts[0] - median(lefts.slice(1)) > tol ? lefts.slice(1) : lefts;
  const rights = lines.map((l) => l.right);
  const centers = lines.map((l) => (l.left + l.right) / 2);
  const leftTight = spread(leftsNoIndent) <= tol;
  const rightTight = spread(rights) <= tol;
  if (lines.length >= 3 && leftTight && spread(rights.slice(0, -1)) <= tol) return 'justify';
  if (leftTight && !rightTight) return 'left';
  if (rightTight && !leftTight) return 'right';
  if (spread(centers) <= tol) return 'center';
  return 'left';
}

export interface Block<L extends Line> {
  lines: L[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  fontSize: number;
}

/**
 * Lines → paragraph blocks: similar font size, normal line spacing and
 * horizontal overlap. `compatible` can veto a merge (e.g. bold vs regular).
 */
export function groupLines<L extends Line>(
  lines: L[],
  compatible: (block: Block<L>, line: L) => boolean = () => true,
  /** Allowed font-size difference; OCR line heights vary with ascenders and descenders. */
  sizeTolerance = 0.2,
): Block<L>[] {
  const sorted = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  const blocks: Block<L>[] = [];
  for (const line of sorted) {
    let best: Block<L> | null = null;
    let bestGap = Infinity;
    for (const b of blocks) {
      const fs = Math.max(b.fontSize, line.fontSize);
      if (Math.abs(b.fontSize - line.fontSize) > sizeTolerance * fs) continue;
      if (!compatible(b, line)) continue;
      const gap = line.top - b.bottom;
      if (gap < -0.4 * fs || gap > 0.9 * fs) continue;
      const overlap = Math.min(b.right, line.right) - Math.max(b.left, line.left);
      const minWidth = Math.min(b.right - b.left, line.right - line.left);
      const aligned = Math.abs(line.left - b.left) < 2 * fs;
      if (overlap <= 0 || (!aligned && overlap < 0.6 * minWidth)) continue;
      if (gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    if (best) {
      best.lines.push(line);
      best.left = Math.min(best.left, line.left);
      best.right = Math.max(best.right, line.right);
      best.bottom = Math.max(best.bottom, line.bottom);
    } else {
      blocks.push({ lines: [line], left: line.left, right: line.right, top: line.top, bottom: line.bottom, fontSize: line.fontSize });
    }
  }
  return blocks;
}

/** Median line pitch relative to font size; single lines get a default. */
export function blockLineHeight(b: Block<Line>): number {
  if (b.lines.length < 2) return 1.2;
  const pitches = b.lines.slice(1).map((l, i) => l.top - b.lines[i].top);
  return Math.min(1.8, Math.max(1.0, median(pitches) / b.fontSize));
}

/** Whether a text block is worth translating at all. */
const UNIT_OR_NUMBER =
  /^([~±×x≈<>≤≥+\-–—/|·•:]|[\d.,:/–\-~]+%?|(\d[\d.,]*)?(V|Hz|W|kW|Wh|kWh|mAh|A|mA|L|ml|mL|kg|g|mg|mm|cm|m|km|°C|°F|℃|h|min|s|ms|dB|ft|lb|oz|rpm|bar|psi|MB|GB|TB))$/i;

export function shouldTranslate(text: string): boolean {
  const t = text.trim();
  // At least two letters anywhere ("第1課" counts; "5" or "→" does not).
  if ((t.match(/\p{L}/gu) ?? []).length < 2) return false;
  // Specs such as "220–240 V ~ 50/60 Hz" or "1.2 kg" stay as they are.
  if (t.split(/\s+/).every((tok) => UNIT_OR_NUMBER.test(tok))) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(t)) return false;
  return true;
}

export function hasControlChars(text: string): boolean {
  return /[\u0000-\u0008\u000e-\u001f�]/.test(text);
}
