import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import type { DetectedLine } from './lines';
import { activeKey } from './settings';
import { deepseekError, describeError, langName, MODELS } from './translate';
import type { ClaudeModelId, Settings } from './types';

/**
 * AI reading of scanned pages. Line positions come from our own line
 * detector; the lines are cropped onto numbered sheets for a vision model,
 * which transcribes each row. Geometry stays exact and no
 * line is skipped, while the reading is far better than Tesseract on
 * Japanese, mixed scripts and small print.
 */

export type LineKind = 'text' | 'number' | 'noise';

export interface LineReading {
  text: string;
  kind: LineKind;
}

export interface ReadOptions {
  sourceLang: string;
  signal?: AbortSignal;
}

export interface AiReader {
  /** Shown in the UI, e.g. "Claude Opus 5.5". */
  label: string;
  /** Distinguishes cached OCR results. */
  key: string;
  read(imageBase64: string, numbers: number[], opts: ReadOptions): Promise<Map<number, LineReading>>;
}

const SYSTEM = `You read scanned document pages for a translation tool.

The image is a list of text lines cropped from one scanned page, one line per row. The red number in the left margin of each row is that line's number. For every number listed by the user, transcribe exactly the text in that row, in the original language and script.

Rules:
- Do not translate. Transcribe only what is in the row; never move text between rows.
- Leave out ruby / furigana (small kana printed above or beside kanji) and dot leaders (……… or .......).
- Keep punctuation, digits, Latin letters and full-width characters as printed; join the characters of one line without inserting spaces between CJK characters.
- kind is "text" for real text, "number" when the row holds only a page number, list marker or bare numeral, and "noise" when it holds no text (part of a drawing, a stain, a ruled line).
- Return every listed number exactly once.`;

const Output = z.object({
  lines: z.array(
    z.object({
      n: z.number().int(),
      text: z.string(),
      kind: z.enum(['text', 'number', 'noise']),
    }),
  ),
});

function userText(numbers: number[], opts: ReadOptions): string {
  const hint = opts.sourceLang === 'auto' ? 'unknown (often Japanese, Chinese or English)' : langName(opts.sourceLang);
  return `Line numbers on this image: ${numbers.join(', ')}.\nSource language: ${hint}.\nTranscribe each row.`;
}

function toMap(lines: z.infer<typeof Output>['lines']): Map<number, LineReading> {
  return new Map(lines.map((l) => [l.n, { text: l.text.trim(), kind: l.kind }]));
}

class ClaudeReader implements AiReader {
  label: string;
  key: string;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: ClaudeModelId,
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    this.label = MODELS.find((m) => m.id === model)?.label ?? model;
    this.key = `ai:${model}`;
  }

  async read(imageBase64: string, numbers: number[], opts: ReadOptions) {
    const fallback =
      this.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
                { type: 'text', text: userText(numbers, opts) },
              ],
            },
          ],
          output_config: { effort: 'low', format: betaZodOutputFormat(Output) },
          ...fallback,
        },
        { signal: opts.signal },
      );
      if (response.stop_reason === 'refusal') throw new Error('模型拒绝识别这一页。');
      if (response.stop_reason === 'max_tokens') throw new Error('这一页文字太多，识别结果被截断。');
      if (!response.parsed_output) throw new Error('模型返回的识别结果无法解析，请重试。');
      return toMap(response.parsed_output.lines);
    } catch (error) {
      throw new Error(describeError(error));
    }
  }
}

/** DeepSeek reads images only with deepseek-flash, whichever model translates. */
class DeepSeekReader implements AiReader {
  label = 'DeepSeek Flash';
  key = 'ai:deepseek-flash';

  constructor(private apiKey: string) {}

  async read(imageBase64: string, numbers: number[], opts: ReadOptions, attempt = 1): Promise<Map<number, LineReading>> {
    let res: Response;
    try {
      res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-flash',
          messages: [
            {
              role: 'system',
              content: `${SYSTEM}\n\nReply with a json object only, in this shape:\n{"lines": [{"n": 1, "text": "…", "kind": "text"}]}`,
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                { type: 'text', text: userText(numbers, opts) },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          max_tokens: 16000,
          stream: false,
        }),
        signal: opts.signal,
      });
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      throw new Error('无法连接到 DeepSeek API，请检查网络。');
    }
    if (!res.ok) throw new Error(await deepseekError(res));
    const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('这一页文字太多，识别结果被截断。');
    const content = choice?.message?.content?.trim();
    try {
      if (!content) throw new Error('empty');
      return toMap(Output.parse(JSON.parse(content)).lines);
    } catch {
      if (attempt < 2) return this.read(imageBase64, numbers, opts, attempt + 1);
      throw new Error('DeepSeek 返回的识别结果无法解析，请重试。');
    }
  }
}

/** The reader for the configured provider, or null when AI reading is off or has no key. */
export function createAiReader(settings: Settings): AiReader | null {
  if (!settings.aiOcr) return null;
  const key = activeKey(settings);
  if (!key) return null;
  return settings.provider === 'deepseek' ? new DeepSeekReader(key) : new ClaudeReader(key, settings.claudeModel);
}

/** Rough cost of reading one page: ~2.5k image tokens per tile in, ~1k tokens out. */
export function aiOcrCostPerPage(settings: Settings): number {
  const id = settings.provider === 'deepseek' ? 'deepseek-flash' : settings.claudeModel;
  const m = MODELS.find((x) => x.id === id)!;
  return (2600 * m.inPerM + 1000 * m.outPerM) / 1e6;
}

// ---------- Line sheets ----------

/** Text height each line is scaled to on the sheet. */
const ROW_TEXT_PX = 40;
const MAX_ROW_W = 1300;
const SHEET_MAX_H = 1500;
const LABEL_W = 64;
const ROW_GAP = 12;

export interface Tile {
  base64: string;
  numbers: number[];
}

/**
 * Crops every detected line (ruby painted out), scales it to a common text
 * height and stacks the crops into "line sheets", one row per line with its
 * number in the margin. The model only has to read rows top to bottom, so it
 * cannot attach a line's text to a neighbouring box the way it can on a full
 * annotated page.
 */
export function lineSheets(page: HTMLCanvasElement, lines: DetectedLine[]): Tile[] {
  const rows = lines.map((l, i) => {
    const lh = l.y1 - l.y0;
    const x0 = Math.max(0, l.x0 - 0.3 * lh);
    const y0 = Math.max(0, l.y0 - 0.2 * lh);
    const x1 = Math.min(page.width, l.x1 + 0.3 * lh);
    const y1 = Math.min(page.height, l.y1 + 0.2 * lh);
    let k = Math.min(3, Math.max(0.4, ROW_TEXT_PX / lh));
    if ((x1 - x0) * k > MAX_ROW_W) k = MAX_ROW_W / (x1 - x0);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((x1 - x0) * k));
    c.height = Math.max(1, Math.round((y1 - y0) * k));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    for (const r of l.ruby) ctx.fillRect((r.x0 - x0) * k - 2, (r.y0 - y0) * k - 2, (r.x1 - r.x0) * k + 4, (r.y1 - r.y0) * k + 4);
    return { n: i + 1, crop: c };
  });

  // Pack rows into sheets no taller than SHEET_MAX_H.
  const sheets: (typeof rows)[] = [];
  let current: typeof rows = [];
  let height = 0;
  for (const row of rows) {
    const h = row.crop.height + ROW_GAP;
    if (current.length && height + h > SHEET_MAX_H) {
      sheets.push(current);
      current = [];
      height = 0;
    }
    current.push(row);
    height += h;
  }
  if (current.length) sheets.push(current);

  return sheets.map((sheet) => {
    const width = LABEL_W + Math.max(...sheet.map((r) => r.crop.width)) + 16;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = sheet.reduce((a, r) => a + r.crop.height + ROW_GAP, ROW_GAP);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    let y = ROW_GAP;
    for (const row of sheet) {
      ctx.fillStyle = 'rgb(225, 29, 72)';
      ctx.fillText(String(row.n), 8, y + row.crop.height / 2);
      ctx.drawImage(row.crop, LABEL_W, y);
      y += row.crop.height + ROW_GAP;
      ctx.fillStyle = '#d4d4d4';
      ctx.fillRect(0, y - ROW_GAP / 2, c.width, 1);
    }
    return { base64: c.toDataURL('image/jpeg', 0.9).split(',')[1], numbers: sheet.map((r) => r.n) };
  });
}
