import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A stylised manual page in layers: English source text, Chinese
 * translation, detection boxes and a scan line. The landing timeline
 * animates these layers; `phase` renders a static end state instead
 * (narrow screens, reduced motion).
 */
export type Phase = 'source' | 'detect' | 'erase' | 'typeset' | 'review';

interface Region {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  en: string;
  zh: string;
  cls?: string;
  ocr?: boolean;
}

/** Page is designed at 560 × 760 and scaled to fit its frame. */
export const PAGE_W = 560;
export const PAGE_H = 760;

const REGIONS: Region[] = [
  { id: 'brand', x: 40, y: 30, w: 140, h: 18, en: 'AquaBrew', zh: 'AquaBrew', cls: 'r-brand' },
  { id: 'title', x: 40, y: 56, w: 420, h: 46, en: 'Smart Kettle SK-200', zh: '智能电水壶 SK-200', cls: 'r-title' },
  { id: 'sub', x: 40, y: 106, w: 240, h: 22, en: 'User Manual', zh: '使用说明书', cls: 'r-sub' },
  {
    id: 'intro',
    x: 40,
    y: 172,
    w: 480,
    h: 40,
    en: 'Thank you for choosing the AquaBrew Smart Kettle. Please read this manual before first use.',
    zh: '感谢您选择 AquaBrew 智能电水壶。首次使用前请仔细阅读本说明书。',
    cls: 'r-body',
  },
  { id: 'h-safety', x: 40, y: 228, w: 220, h: 24, en: 'Safety instructions', zh: '安全须知', cls: 'r-head' },
  { id: 's1', x: 58, y: 262, w: 460, h: 20, en: 'Only use an earthed socket that matches the rated voltage.', zh: '仅可使用与额定电压相符的接地插座。', cls: 'r-body' },
  { id: 's2', x: 58, y: 288, w: 460, h: 20, en: 'Do not immerse the kettle or power base in water.', zh: '请勿将水壶或电源底座浸入水中。', cls: 'r-body' },
  { id: 's3', x: 58, y: 314, w: 460, h: 20, en: 'Keep out of reach of children under 8 years.', zh: '请放在 8 岁以下儿童接触不到的地方。', cls: 'r-body' },
  { id: 'warn-t', x: 62, y: 356, w: 120, h: 18, en: 'WARNING', zh: '警告', cls: 'r-warn-t' },
  { id: 'warn', x: 62, y: 378, w: 440, h: 20, en: 'Steam can cause burns. Do not open the lid while boiling.', zh: '蒸汽可能造成烫伤。水沸腾时请勿打开壶盖。', cls: 'r-warn' },
  { id: 'h-fig', x: 40, y: 430, w: 200, h: 24, en: 'Product overview', zh: '产品概览', cls: 'r-head' },
  { id: 'l-lid', x: 236, y: 470, w: 104, h: 18, en: 'Lid button', zh: '开盖按钮', cls: 'r-label', ocr: true },
  { id: 'l-level', x: 52, y: 572, w: 96, h: 36, en: 'Water level window', zh: '水位窗', cls: 'r-label', ocr: true },
  { id: 'l-dial', x: 404, y: 640, w: 104, h: 36, en: 'Temperature dial', zh: '温度旋钮', cls: 'r-label', ocr: true },
  { id: 'l-base', x: 52, y: 690, w: 96, h: 18, en: 'Power base', zh: '电源底座', cls: 'r-label', ocr: true },
  { id: 'foot', x: 200, y: 728, w: 160, h: 14, en: 'AquaBrew SK-200 · Page 1', zh: 'AquaBrew SK-200 · 第 1 页', cls: 'r-foot' },
];

/** Toon-shaded kettle in two tones, the figure the OCR labels point at. */
function Kettle() {
  return (
    <svg className="kettle" viewBox="0 0 480 270" aria-hidden>
      <defs>
        <pattern id="ds-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--blue)" strokeWidth="1.1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="480" height="270" fill="var(--page-tint)" />
      <path d="M0 200 L480 168 L480 270 L0 270 Z" fill="url(#ds-hatch)" opacity="0.55" />
      <g stroke="var(--ink-blue)" strokeWidth="2.4" strokeLinejoin="round">
        <path d="M168 56 L312 56 L330 206 L150 206 Z" fill="var(--cream)" />
        <path d="M240 56 L312 56 L330 206 L246 206 Z" fill="var(--blue)" />
        <rect x="182" y="38" width="116" height="24" rx="10" fill="var(--blue)" />
        <path d="M312 84 C 372 84, 376 176, 324 182" fill="none" />
        <path d="M168 76 L120 52" fill="none" />
        <rect x="140" y="206" width="200" height="30" rx="10" fill="var(--cream)" />
        <path d="M240 206 L340 206 L340 226 Q 340 236 330 236 L240 236 Z" fill="var(--blue)" />
        <rect x="196" y="92" width="18" height="96" rx="6" fill="var(--cream)" />
        <circle cx="300" cy="221" r="9" fill="var(--orange)" />
        <circle cx="240" cy="38" r="6" fill="var(--cream)" />
      </g>
      <g stroke="var(--ink-blue)" strokeWidth="1.2" fill="none" opacity="0.8">
        <path d="M240 32 L240 8" />
        <path d="M196 132 L100 132" />
        <path d="M309 221 L362 221" />
        <path d="M150 230 L96 254" />
      </g>
    </svg>
  );
}

function Page({ ghost }: { ghost?: boolean }) {
  return (
    <div className={`ds-page ${ghost ? 'ds-ghost' : ''}`} style={{ width: PAGE_W, height: PAGE_H }}>
      <div className="ds-banner">
        <i className="ds-orb ds-orb-1" />
        <i className="ds-orb ds-orb-2" />
      </div>
      <i className="ds-bullet" style={{ top: 269 }} />
      <i className="ds-bullet" style={{ top: 295 }} />
      <i className="ds-bullet" style={{ top: 321 }} />
      <div className="ds-warnbox" />
      <div className="ds-figure">
        <Kettle />
      </div>
      {REGIONS.map((r) => (
        <div
          key={r.id}
          className={`rg ${r.cls ?? ''} ${r.ocr ? 'rg-ocr' : ''}`}
          data-id={r.id}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        >
          <span className="en">{r.en}</span>
          {!ghost && <span className="zh">{r.zh}</span>}
          {!ghost && <i className="rg-box" />}
        </div>
      ))}
      {!ghost && <i className="ds-scan" />}
    </div>
  );
}

interface Props {
  phase?: Phase;
}

export function DocStage({ phase }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.6);

  // Static renders scale the page to the width of their container.
  useLayoutEffect(() => {
    if (!phase || !box.current) return;
    const el = box.current;
    const ro = new ResizeObserver(() => setFit(el.clientWidth / PAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  return (
    <div
      ref={box}
      className={`ds ${phase ? `ds-static is-${phase}` : ''}`}
    >
      <div className="ds-camera" style={phase ? { transform: `scale(${fit})` } : undefined}>
        <div className="ds-ghost-wrap">
          <Page ghost />
        </div>
        <div className="ds-live">
          <Page />
          <svg className="ds-notes" viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} aria-hidden>
            <path className="note-path" d="M110 -40 C 140 -10, 170 10, 190 46" />
            <path className="note-path" d="M120 800 C 140 774, 120 744, 100 712" />
          </svg>
          <p className="ds-note ds-note-1">same size, same spot</p>
          <p className="ds-note ds-note-2">check: label fits ✓</p>
        </div>
      </div>
    </div>
  );
}
