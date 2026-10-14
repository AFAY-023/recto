import type React from 'react';
import { useMemo } from 'react';
import { liveIssues } from '../lib/pipeline';
import type { Page } from '../lib/types';

function thumbUrl(page: Page): string {
  const c = document.createElement('canvas');
  const w = 120;
  c.width = w;
  c.height = Math.round((w * page.source.height) / page.source.width);
  c.getContext('2d')!.drawImage(page.source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

const STATUS_LABEL: Record<Page['status'], string> = {
  analyzing: '识别中',
  ready: '待翻译',
  translating: '翻译中',
  done: '已翻译',
  error: '出错',
};

function Thumb({ page, active, onClick }: { page: Page; active: boolean; onClick: () => void }) {
  const url = useMemo(() => thumbUrl(page), [page.source]);
  const issues = liveIssues(page).filter((i) => i.severity !== 'info').length;
  return (
    <button type="button" className={`thumb ${active ? 'thumb-active' : ''}`} style={{ '--i': page.index } as React.CSSProperties} onClick={onClick} aria-label={`第 ${page.index + 1} 页，${STATUS_LABEL[page.status]}`}>
      <img src={url} alt="" />
      <span className="thumb-meta">
        <span>{page.index + 1}</span>
        <span className={`dot dot-${page.status}`} title={STATUS_LABEL[page.status]} />
        {issues > 0 && <span className="thumb-warn">{issues}</span>}
      </span>
    </button>
  );
}

export function Thumbs({ pages, current, onPick }: { pages: Page[]; current: number; onPick: (i: number) => void }) {
  return (
    <nav className="thumbs" aria-label="页面">
      {pages.map((p, i) => (
        <Thumb key={p.index} page={p} active={i === current} onClick={() => onPick(i)} />
      ))}
    </nav>
  );
}
