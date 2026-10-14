import { useEffect, useRef } from 'react';
import { renderTranslated } from '../lib/layout';
import type { Page } from '../lib/types';

export type View = 'translated' | 'source' | 'compare';

interface Props {
  page: Page;
  lang: string;
  view: View;
  showBoxes: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function Canvas({ page, lang, translated }: { page: Page; lang: string; translated: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (translated) {
      renderTranslated(page, lang, canvas);
    } else {
      canvas.width = page.source.width;
      canvas.height = page.source.height;
      canvas.getContext('2d')!.drawImage(page.source, 0, 0);
    }
  }, [page, page.revision, lang, translated]);
  return <canvas ref={ref} className="page-canvas" />;
}

function Sheet({ page, lang, translated, showBoxes, selectedId, onSelect, label }: Omit<Props, 'view'> & { translated: boolean; label?: string }) {
  return (
    <figure className="sheet-wrap">
      {label && <figcaption className="sheet-label">{label}</figcaption>}
      <div
        className={`sheet ${translated && page.status === 'done' ? 'sheet-done' : ''}`}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onClick={() => onSelect(null)}
      >
        <Canvas page={page} lang={lang} translated={translated} />
        {showBoxes &&
          page.regions.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={[
                'box',
                r.origin === 'ocr' ? 'box-ocr' : '',
                r.id === selectedId ? 'box-selected' : '',
                r.overflow ? 'box-overflow' : '',
                r.translate ? '' : 'box-skip',
              ].join(' ')}
              style={{
                left: `${(r.bbox.x / page.width) * 100}%`,
                top: `${(r.bbox.y / page.height) * 100}%`,
                width: `${(r.bbox.w / page.width) * 100}%`,
                height: `${(r.bbox.h / page.height) * 100}%`,
              }}
              title={r.text}
              aria-label={`第 ${i + 1} 段：${r.text.slice(0, 40)}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.id);
              }}
            />
          ))}
      </div>
    </figure>
  );
}

export function PageView(props: Props) {
  const { view, ...rest } = props;
  if (view === 'compare') {
    return (
      <div className="compare">
        <Sheet {...rest} translated={false} label="原文" />
        <Sheet {...rest} translated label="译文" />
      </div>
    );
  }
  return <Sheet {...rest} translated={view === 'translated'} />;
}
