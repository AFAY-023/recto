import { useEffect, useRef, useState } from 'react';
import { aiOcrCostPerPage } from '../lib/aiocr';
import { checkKey, type KeyCheck } from '../lib/keycheck';
import { MODELS } from '../lib/translate';
import type { Provider, Settings } from '../lib/types';

interface Props {
  open: boolean;
  settings: Settings;
  reason?: string;
  onClose: () => void;
  onSave: (s: Settings) => void;
}

const PROVIDERS: { id: Provider; label: string; keyHint: string; console: string }[] = [
  { id: 'anthropic', label: 'Claude', keyHint: 'sk-ant-…', console: 'console.anthropic.com' },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'sk-…', console: 'platform.deepseek.com' },
];

export function SettingsDialog({ open, settings, reason, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const [reveal, setReveal] = useState(false);
  const [check, setCheck] = useState<KeyCheck | 'checking' | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setDraft(settings);
      setCheck(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, settings]);

  const provider = PROVIDERS.find((p) => p.id === draft.provider)!;
  const isDeepSeek = draft.provider === 'deepseek';
  const key = isDeepSeek ? draft.deepseekKey : draft.claudeKey;
  const setKey = (v: string) => {
    setCheck(null);
    setDraft(isDeepSeek ? { ...draft, deepseekKey: v } : { ...draft, claudeKey: v });
  };
  const runCheck = async () => {
    setCheck('checking');
    setCheck(await checkKey(draft.provider, key));
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form method="dialog" onSubmit={() => onSave(draft)}>
        <p className="eyebrow">设置</p>
        <h2>翻译引擎</h2>
        {reason && <p className="dialog-reason">{reason}</p>}

        <div className="field">
          <span>服务商</span>
          <div className="seg seg-wide" role="radiogroup" aria-label="服务商">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={draft.provider === p.id}
                className={draft.provider === p.id ? 'on' : ''}
                onClick={() => {
                  setCheck(null);
                  setDraft({ ...draft, provider: p.id });
                }}
              >
                {p.label}
                {(p.id === 'deepseek' ? draft.deepseekKey : draft.claudeKey) && <span className="key-dot" title="已填写 Key" />}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>{provider.label} API Key</span>
          <div className="key-row">
            <input
              type={reveal ? 'text' : 'password'}
              value={key}
              placeholder={provider.keyHint}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value.replace(/[\s​-‍﻿]/g, ''))}
            />
            <button type="button" className="btn-ghost" onClick={() => setReveal(!reveal)}>
              {reveal ? '隐藏' : '显示'}
            </button>
            <button type="button" className="btn-ghost" onClick={runCheck} disabled={!key || check === 'checking'}>
              {check === 'checking' ? '测试中…' : '测试 Key'}
            </button>
          </div>
          {key && (
            <small className="key-meta">
              当前 Key：{key.slice(0, 3)}…{key.slice(-4)}（{key.length} 位）· 可以和平台 Key 列表里的末四位核对
            </small>
          )}
          {check && check !== 'checking' && <p className={`key-check ${check.ok ? 'key-ok' : 'key-bad'}`}>{check.message}</p>}
          <small>
            在 {provider.console} 获取。Key 只保存在这台设备的浏览器里，翻译时直接发给 {provider.label}，不经过任何其他服务器。两家的 Key 可以都填，用哪家以上面的选择为准。
          </small>
        </label>

        <label className="field">
          <span>模型</span>
          <select
            value={isDeepSeek ? draft.deepseekModel : draft.claudeModel}
            onChange={(e) =>
              setDraft(
                isDeepSeek
                  ? { ...draft, deepseekModel: e.target.value as Settings['deepseekModel'] }
                  : { ...draft, claudeModel: e.target.value as Settings['claudeModel'] },
              )
            }
          >
            {MODELS.filter((m) => m.provider === draft.provider).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.note}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-check">
          <input type="checkbox" checked={draft.aiOcr} onChange={(e) => setDraft({ ...draft, aiOcr: e.target.checked })} />
          <span>
            <strong>AI 识别扫描件和图片</strong>
            <small>
              用视觉模型逐行读字，日文、中日混排、小字和带注音的页面比本地 OCR 准得多；行的位置仍由本地检测，译文会回到原位。每页额外约 $
              {aiOcrCostPerPage(draft) < 0.01 ? aiOcrCostPerPage(draft).toFixed(3) : aiOcrCostPerPage(draft).toFixed(2)}
              {isDeepSeek ? '。DeepSeek 识别时固定使用 deepseek-flash（V4 Pro 不支持图片）。' : '。'}
            </small>
          </span>
        </label>

        <label className="field">
          <span>术语表</span>
          <textarea
            rows={5}
            value={draft.glossary}
            placeholder={'每行一条，例如：\npower base = 电源底座\ndescale = 除垢'}
            onChange={(e) => setDraft({ ...draft, glossary: e.target.value })}
          />
          <small>同一个词在整份文档里都会按这里的写法翻译。</small>
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn-primary">
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}
