/** Page units: PDF points for PDF pages, pixels for image pages. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Align = 'left' | 'center' | 'right' | 'justify';
export type FontCategory = 'sans' | 'serif' | 'mono';

/** text = PDF text layer only, image = OCR on the page image, smart = both. */
export type Mode = 'text' | 'image' | 'smart';
export type ModeChoice = Mode | 'auto';

export interface Region {
  id: string;
  /** Where the source text came from: the PDF text layer or OCR. */
  origin: 'pdf' | 'ocr';
  text: string;
  translation?: string;
  bbox: BBox;
  /** Tight per-line boxes; OCR regions erase only these, sparing the image around them. */
  masks?: BBox[];
  fontSize: number;
  lineHeight: number;
  bold: boolean;
  italic: boolean;
  fontCategory: FontCategory;
  color: string;
  background: string;
  align: Align;
  rotation: number;
  /** False for part numbers, URLs, symbols — kept as-is. */
  translate: boolean;
  /** User-adjusted multiplier on the fitted font size. */
  fontScale: number;
  confidence?: number;
  /** Set by layout when the translation could not fit its box. */
  overflow?: boolean;
  edited?: boolean;
}

export type Severity = 'block' | 'warn' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  regionId?: string;
}

export type Classification = 'no_text' | 'sparse' | 'native' | 'complex' | 'image';

export type PageStatus = 'analyzing' | 'ready' | 'translating' | 'done' | 'error';

export interface Page {
  index: number;
  width: number;
  height: number;
  /** Bitmap pixels per page unit. */
  scale: number;
  source: HTMLCanvasElement;
  /** The page rendered without its text-drawing operators (PDF only). */
  background: HTMLCanvasElement | null;
  /** Regions in use for the current mode (what gets translated and drawn). */
  regions: Region[];
  /** Text-layer regions from the PDF, kept so modes can be switched. */
  native: Region[];
  /** OCR result, cached per input bitmap and language. */
  ocr?: { key: string; regions: Region[]; langs: string };
  nativeChars: number;
  classification: Classification;
  recommended: Mode;
  mode: Mode;
  status: PageStatus;
  issues: Issue[];
  error?: string;
  /** Bumped whenever regions change, to trigger a redraw. */
  revision: number;
}

export interface Doc {
  name: string;
  kind: 'pdf' | 'image';
  pages: Page[];
  isSample?: boolean;
  /** Original bytes, kept so OCR can re-render pages at high resolution. */
  pdfData?: ArrayBuffer;
  imageFile?: Blob;
  /** Source language guessed from the document's own text layer. */
  langHint?: string;
  /** SHA-256 of the file, used to cache OCR results across reloads. */
  hash?: string;
}

/** What OCR needs to know about the document a page belongs to. */
export type OcrContext = Pick<Doc, 'pdfData' | 'imageFile' | 'langHint' | 'hash'>;

export type Provider = 'anthropic' | 'deepseek';

export type ClaudeModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type DeepSeekModelId = 'deepseek-flash' | 'deepseek-v4-pro';
export type ModelId = ClaudeModelId | DeepSeekModelId;

export interface Settings {
  provider: Provider;
  claudeKey: string;
  claudeModel: ClaudeModelId;
  deepseekKey: string;
  deepseekModel: DeepSeekModelId;
  sourceLang: string;
  targetLang: string;
  mode: ModeChoice;
  glossary: string;
  /** Read scans and images with a vision model instead of Tesseract. */
  aiOcr: boolean;
}
