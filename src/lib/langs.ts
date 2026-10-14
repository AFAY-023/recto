export interface Lang {
  code: string;
  /** Name shown in the UI. */
  label: string;
  /** English name sent to the model. */
  english: string;
  /** Tesseract traineddata code. */
  ocr: string;
  script: 'latin' | 'cjk-sc' | 'cjk-tc' | 'ja' | 'ko' | 'cyrillic' | 'arabic' | 'thai' | 'other';
}

export const LANGS: Lang[] = [
  { code: 'en', label: 'English', english: 'English', ocr: 'eng', script: 'latin' },
  { code: 'zh-CN', label: '简体中文', english: 'Simplified Chinese', ocr: 'chi_sim', script: 'cjk-sc' },
  { code: 'zh-TW', label: '繁體中文', english: 'Traditional Chinese', ocr: 'chi_tra', script: 'cjk-tc' },
  { code: 'ja', label: '日本語', english: 'Japanese', ocr: 'jpn', script: 'ja' },
  { code: 'ko', label: '한국어', english: 'Korean', ocr: 'kor', script: 'ko' },
  { code: 'fr', label: 'Français', english: 'French', ocr: 'fra', script: 'latin' },
  { code: 'de', label: 'Deutsch', english: 'German', ocr: 'deu', script: 'latin' },
  { code: 'es', label: 'Español', english: 'Spanish', ocr: 'spa', script: 'latin' },
  { code: 'it', label: 'Italiano', english: 'Italian', ocr: 'ita', script: 'latin' },
  { code: 'pt', label: 'Português', english: 'Portuguese', ocr: 'por', script: 'latin' },
  { code: 'nl', label: 'Nederlands', english: 'Dutch', ocr: 'nld', script: 'latin' },
  { code: 'ru', label: 'Русский', english: 'Russian', ocr: 'rus', script: 'cyrillic' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', ocr: 'vie', script: 'latin' },
  { code: 'th', label: 'ไทย', english: 'Thai', ocr: 'tha', script: 'thai' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian', ocr: 'ind', script: 'latin' },
  { code: 'ar', label: 'العربية', english: 'Arabic', ocr: 'ara', script: 'arabic' },
];

export const AUTO_SOURCE = 'auto';

export function findLang(code: string): Lang | undefined {
  return LANGS.find((l) => l.code === code);
}

/** Scripts written without spaces between words. */
export function isUnspacedScript(code: string): boolean {
  const s = findLang(code)?.script;
  return s === 'cjk-sc' || s === 'cjk-tc' || s === 'ja' || s === 'thai';
}

const STACKS: Record<Lang['script'], { sans: string; serif: string }> = {
  latin: { sans: 'Inter, "Helvetica Neue", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif' },
  cyrillic: { sans: '"Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif' },
  'cjk-sc': {
    sans: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif',
    serif: '"Songti SC", "Noto Serif SC", SimSun, serif',
  },
  'cjk-tc': {
    sans: '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
    serif: '"Songti TC", "Noto Serif TC", PMingLiU, serif',
  },
  ja: { sans: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif', serif: '"Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", serif' },
  ko: { sans: '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif', serif: '"Noto Serif KR", Batang, serif' },
  arabic: { sans: '"Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif', serif: '"Noto Naskh Arabic", serif' },
  thai: { sans: '"Noto Sans Thai", Tahoma, sans-serif', serif: '"Noto Serif Thai", serif' },
  other: { sans: 'system-ui, sans-serif', serif: 'serif' },
};

export function fontStack(langCode: string, category: 'sans' | 'serif' | 'mono'): string {
  if (category === 'mono') return '"Cascadia Mono", Consolas, "Courier New", monospace';
  const script = findLang(langCode)?.script ?? 'other';
  return STACKS[script][category];
}

/** Guesses a language from the scripts used in a text sample. */
export function guessLangFromText(text: string): string | undefined {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯]/g);
  const han = count(/[一-鿿]/g);
  if (kana > 5 && kana >= han * 0.15) return 'ja';
  if (hangul > 5) return 'ko';
  if (han > 5) return 'zh-CN';
  if (count(/[Ѐ-ӿ]/g) > 10) return 'ru';
  if (count(/[؀-ۿ]/g) > 10) return 'ar';
  if (count(/[฀-๿]/g) > 10) return 'th';
  if (count(/[a-z]/gi) > 20) return 'en';
  return undefined;
}

function browserLang(): string | undefined {
  const nav = (navigator.language || '').toLowerCase();
  if (/^zh-(tw|hk|mo)|hant/.test(nav)) return 'zh-TW';
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('ko')) return 'ko';
  return undefined;
}

export interface OcrLangs {
  /** Tesseract language string, e.g. "chi_sim+eng". */
  code: string;
  label: string;
  cjk: boolean;
}

/**
 * Languages to OCR with. "Auto" uses the document's own text, then the
 * browser language; English is always added because most documents mix in
 * Latin text (model numbers, URLs, brand names).
 */
export function ocrLangs(sourceLang: string, hint?: string): OcrLangs {
  const auto = sourceLang === AUTO_SOURCE;
  const code = auto ? hint ?? browserLang() ?? 'en' : sourceLang;
  const lang = findLang(code) ?? LANGS[0];
  const cjk = lang.script.startsWith('cjk') || lang.script === 'ja' || lang.script === 'ko';
  // Chinese and Japanese often share a document (textbooks, imported manuals) and
  // their scripts overlap, so "auto" runs both models and lets Tesseract pick per word.
  if (auto && (lang.script.startsWith('cjk') || lang.script === 'ja')) {
    const chinese = lang.script === 'cjk-tc' ? 'chi_tra' : 'chi_sim';
    return { code: `jpn+${chinese}+eng`, label: '日本語 + 中文 + English', cjk: true };
  }
  if (lang.ocr === 'eng') return { code: 'eng', label: 'English', cjk: false };
  return { code: `${lang.ocr}+eng`, label: `${lang.label} + English`, cjk };
}
