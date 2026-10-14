import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Issue, Page, Region } from '../lib/types';

interface Props {
  page: Page;
  issues: Issue[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Region>) => void;
  onRetranslate: (id: string) => void;
}

const SEVERITY_LABEL = { block: '需处理', warn: '注意', info: '提示' } as const;

function RegionCard({
  region,
  index,
  selected,
  busy,
  onSelect,
  onChange,
  onRetranslate,
}: {
  region: Region;
  index: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Region>) => void;
  onRetranslate: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(region.translation ?? '');
  const [source, setSource] = useState(region.text);
  useEffect(() => setDraft(region.translation ?? ''), [region.translation]);
  useEffect(() => setSource(region.text), [region.text]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const commit = () => {
    if (draft !== (region.translation ?? '')) onChange({ translation: draft, edited: true });
  };

  return (
    <div
      ref={ref}
      className={`card ${selected ? 'card-selected' : ''} ${region.translate ? '' : 'card-skip'}`}
      style={{ '--i': index } as React.CSSProperties}
      onClick={onSelect}
    >
      <div className="card-head">
        <span className="card-no">{index + 1}</span>
        <span className={`tag ${region.origin === 'ocr' ? 'tag-ocr' : 'tag-pdf'}`}>{region.origin === 'ocr' ? '图片文字' : '文字层'}</span>
        {region.overflow && <span className="tag tag-warn">放不下</span>}
        {region.edited && <span className="tag">已手改</span>}
        <label className="card-toggle" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={region.translate} aria-label="翻译这一段" onChange={(e) => onChange({ translate: e.target.checked })} />
          翻译
        </label>
      </div>
      {selected ? (
        <textarea
          className="src-edit"
          value={source}
          rows={Math.min(4, source.split('\n').length + 1)}
          aria-label="原文（可修正识别错误）"
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => source !== region.text && onChange({ text: source })}
        />
      ) : (
        <p className="src">{region.text}</p>
      )}
      {region.translate && (
        <>
          <textarea
            className="dst"
            value={draft}
            placeholder="尚未翻译"
            rows={Math.max(2, Math.min(6, draft.split('\n').length + 1))}
            aria-label="译文"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onFocus={onSelect}
          />
          {selected && (
            <div className="card-actions">
              <span className="muted">字号</span>
              <button type="button" className="btn-mini" onClick={() => onChange({ fontScale: Math.max(0.5, +(region.fontScale - 0.1).toFixed(2)) })} aria-label="缩小字号">
                −
              </button>
              <span className="mono">{Math.round(region.fontScale * 100)}%</span>
              <button type="button" className="btn-mini" onClick={() => onChange({ fontScale: Math.min(1.6, +(region.fontScale + 0.1).toFixed(2)) })} aria-label="放大字号">
                +
              </button>
              <span className="spacer" />
              <button type="button" className="btn-mini" disabled={busy} onClick={onRetranslate}>
                重新翻译
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RegionPanel({ page, issues, selectedId, busy, onSelect, onChange, onRetranslate }: Props) {
  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>第 {page.index + 1} 页</h2>
        <span className="muted">{page.regions.length} 段文字</span>
      </div>
      {page.ocr && page.mode !== 'text' && (
        <p className="ocr-info">
          识别方式：{page.ocr.langs}
          <span>
            {page.ocr.langs.startsWith('AI')
              ? '框出的每一行由视觉模型读字；位置不对的段落可以取消"翻译"。'
              : '识别不准？在顶部"原文"里选对语言再识别，或在设置里打开"AI 识别"。'}
          </span>
        </p>
      )}
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((it) => (
            <li key={it.code} className={`issue issue-${it.severity}`} onClick={() => it.regionId && onSelect(it.regionId)}>
              <strong>{SEVERITY_LABEL[it.severity]}</strong>
              {it.message}
            </li>
          ))}
        </ul>
      )}
      <div className="cards">
        {page.regions.length === 0 && (
          <p className="empty-note">
            {page.mode === 'text' ? '这一页没有可提取的文字层。可以在顶部把识别方式切换为“图片 OCR”。' : '点击“翻译”后会先识别图片里的文字。'}
          </p>
        )}
        {page.regions.map((r, i) => (
          <RegionCard
            key={r.id}
            region={r}
            index={i}
            selected={r.id === selectedId}
            busy={busy}
            onSelect={() => onSelect(r.id)}
            onChange={(patch) => onChange(r.id, patch)}
            onRetranslate={() => onRetranslate(r.id)}
          />
        ))}
      </div>
    </aside>
  );
}
