import type { ModelId, Settings } from './types';

const KEY = 'recto.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  deepseekKey: '',
  deepseekModel: 'deepseek-flash',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  mode: 'auto',
  glossary: '',
  aiOcr: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Earlier versions stored a single Claude key and model.
      if (saved.apiKey && !saved.claudeKey) saved.claudeKey = saved.apiKey;
      if (saved.model && !saved.claudeModel) saved.claudeModel = saved.model;
      delete saved.apiKey;
      delete saved.model;
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    // Storage unavailable (private mode); fall back to defaults.
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings just won't persist.
  }
}

export function activeKey(s: Settings): string {
  return s.provider === 'deepseek' ? s.deepseekKey : s.claudeKey;
}

export function activeModel(s: Settings): ModelId {
  return s.provider === 'deepseek' ? s.deepseekModel : s.claudeModel;
}
