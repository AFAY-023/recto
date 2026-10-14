import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { DocStage } from './DocStage';

/**
 * Use cases: numbered selector cards over one large before/after preview.
 * The preview stacks the original and the translated page and reveals the
 * translation through a draggable divider.
 */

type Side = 'src' | 'dst';

interface Case {
  id: string;
  title: string;
  body: string;
  from: string;
  to: string;
  note: string;
  page: (side: Side) => ReactNode;
}

/** Renders fixed-size page art scaled to the width of its container. */
function Scaled({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={box} className="scaled" style={{ aspectRatio: `${w} / ${h}` }}>
      <div style={{ width: w, height: h, transform: `scale(${k})`, transformOrigin: '0 0' }}>{children}</div>
    </div>
  );
}

function Manual({ side }: { side: Side }) {
  return (
    <div className="mini-manual">
      <DocStage phase={side === 'src' ? 'source' : 'typeset'} />
    </div>
  );
}

function Picturebook({ side }: { side: Side }) {
  const ja = side === 'src';
  return (
    <div className="mini-page mini-book">
      <svg className="pb-art" viewBox="0 0 560 760" aria-hidden>
        <defs>
          <linearGradient id="pb-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1f2d5c" />
            <stop offset="1" stopColor="#4a5f9e" />
          </linearGradient>
        </defs>
        <rect width="560" height="760" fill="url(#pb-sky)" />
        <g fill="#fff6d8">
          <circle cx="78" cy="210" r="2.5" />
          <circle cx="150" cy="150" r="2" />
          <circle cx="250" cy="236" r="2.5" />
          <circle cx="470" cy="300" r="2" />
          <circle cx="330" cy="120" r="1.8" />
        </g>
        <circle cx="420" cy="190" r="70" fill="#fbe7a1" />
        <circle cx="398" cy="174" r="12" fill="#f1d685" />
        <circle cx="440" cy="212" r="8" fill="#f1d685" />
        <path d="M0 520 C 120 450, 240 470, 330 510 S 500 470, 560 490 V760 H0Z" fill="#2f5d4a" />
        <path d="M0 590 C 140 540, 300 560, 560 540 V760 H0Z" fill="#3f7a5c" />
        <g fill="#244a3a">
          <path d="M70 540 L100 420 L130 540Z" />
          <path d="M108 545 L146 390 L184 545Z" />
          <path d="M470 520 L500 410 L530 520Z" />
        </g>
        <g transform="translate(255 520)">
          <path d="M-40 40 C -42 10, -20 -6, 0 -4 C 24 -2, 40 16, 38 40Z" fill="#e0793c" />
          <path d="M-22 -2 L-30 -36 L-8 -10Z M14 -4 L22 -36 L30 -6Z" fill="#e0793c" />
          <path d="M38 34 C 70 30, 84 6, 76 -14 C 70 6, 56 18, 34 18Z" fill="#e8955e" />
          <circle cx="-8" cy="12" r="3" fill="#2a1b12" />
          <circle cx="12" cy="12" r="3" fill="#2a1b12" />
        </g>
      </svg>
      <p className="pb-title">{ja ? 'きつねと　つき' : '小狐狸和月亮'}</p>
      <p className="pb-text">
        {ja
          ? 'よるの　もりで、こぎつねは　まあるい　おつきさまを　みつけました。'
          : '夜晚的森林里，小狐狸发现了一轮圆圆的月亮。'}
      </p>
      <span className="pb-folio">{ja ? '— 3 —' : '— 3 —'}</span>
    </div>
  );
}

function Comic({ side }: { side: Side }) {
  const en = side === 'src';
  const face = (x: number, y: number, mouth: string) => (
    <g fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round">
      <circle cx={x} cy={y} r="34" fill="#fff" />
      <circle cx={x - 11} cy={y - 6} r="3" fill="#1a1a1a" />
      <circle cx={x + 11} cy={y - 6} r="3" fill="#1a1a1a" />
      <path d={mouth} />
      <path d={`M${x - 30} ${y + 60} Q ${x} ${y + 30} ${x + 30} ${y + 60}`} />
    </g>
  );
  return (
    <div className="mini-page mini-comic">
      <div className="cm-grid">
        <div className="cm-panel cm-a">
          <p className="cm-caption">{en ? 'Meanwhile, in the kitchen…' : '与此同时，厨房里……'}</p>
          <svg viewBox="0 0 520 220" aria-hidden>
            {face(120, 130, 'M108 142 Q120 150 132 142')}
            <rect x="300" y="140" width="130" height="16" rx="8" fill="#d9c8a4" stroke="#1a1a1a" strokeWidth="3" />
            <ellipse cx="365" cy="132" rx="44" ry="16" fill="#f3c46b" stroke="#1a1a1a" strokeWidth="3" />
          </svg>
          <p className="cm-bubble cm-b1">{en ? 'Finally — lunch!' : '终于，午饭来了！'}</p>
        </div>
        <div className="cm-panel cm-b">
          <svg viewBox="0 0 250 260" aria-hidden>
            {face(125, 160, 'M112 172 Q125 162 138 172')}
          </svg>
          <p className="cm-bubble cm-b2">{en ? 'Wait… where did it go?' : '等等……去哪儿了？'}</p>
        </div>
        <div className="cm-panel cm-c">
          <svg viewBox="0 0 250 260" aria-hidden>
            <g fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round">
              <ellipse cx="125" cy="190" rx="60" ry="34" fill="#fff" />
              <path d="M85 168 L74 140 L100 160 M150 160 L176 140 L165 168" fill="#fff" />
              <circle cx="108" cy="186" r="3" fill="#1a1a1a" />
              <circle cx="142" cy="186" r="3" fill="#1a1a1a" />
              <path d="M180 196 Q 220 200 228 170" />
            </g>
          </svg>
          <p className="cm-sfx">{en ? 'CRUNCH!' : '咔嚓！'}</p>
        </div>
      </div>
    </div>
  );
}

function Ad({ side }: { side: Side }) {
  const en = side === 'src';
  return (
    <div className="mini-page mini-ad">
      <p className="ad-kicker">{en ? 'NEW · LIMITED EDITION' : '新品 · 限量版'}</p>
      <p className="ad-head">{en ? 'Run lighter this summer.' : '这个夏天，跑得更轻。'}</p>
      <svg className="ad-art" viewBox="0 0 480 260" aria-hidden>
        <ellipse cx="240" cy="226" rx="190" ry="16" fill="rgb(0 0 0 / 0.12)" />
        <path
          d="M60 190 C 60 150, 110 140, 150 120 C 190 100, 210 70, 250 70 C 270 110, 300 120, 350 130 C 400 140, 430 160, 430 190 Q 430 212 400 212 H 90 Q 60 212 60 190Z"
          fill="#fff"
          stroke="#16222f"
          strokeWidth="4"
        />
        <path d="M60 192 H430" stroke="#ff6a3d" strokeWidth="14" />
        <path d="M190 104 L230 140 M210 92 L250 128 M232 84 L268 118" stroke="#16222f" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <div className="ad-badge">
        <span>{en ? 'UP TO' : '低至'}</span>
        <b>{en ? '40% OFF' : '六折'}</b>
      </div>
      <p className="ad-body">{en ? 'Breathable mesh. 210 g per shoe.' : '透气网面，单只仅重 210 克。'}</p>
      <p className="ad-cta">{en ? 'Shop now →' : '立即选购 →'}</p>
    </div>
  );
}

const CASES: Case[] = [
  {
    id: 'book',
    title: '儿童绘本',
    body: '以插图为主的绘本，文字直接压在画面上。翻完插图不变，检查一遍就能导出给孩子读。',
    from: '日本語',
    to: '简体中文',
    note: '压在画面上的文字也能换：先擦掉原文，用周围的颜色补齐，再把译文写回原来的位置。',
    page: (s) => (
      <Scaled w={560} h={760}>
        <Picturebook side={s} />
      </Scaled>
    ),
  },
  {
    id: 'manual',
    title: '说明书与技术文档',
    body: '产品说明书、操作手册、带标注的示意图。编号、型号和单位原样保留，图里的标注一起翻。',
    from: 'English',
    to: '简体中文',
    note: '电子版 PDF 直接读文字层，渐变横幅和插图都不会留下擦除痕迹。',
    page: (s) => (
      <Scaled w={560} h={760}>
        <Manual side={s} />
      </Scaled>
    ),
  },
  {
    id: 'comic',
    title: '漫画与对白气泡',
    body: '对白气泡、旁白框和拟声词。译文留在气泡里，不用一整块白底把画面盖住。',
    from: 'English',
    to: '简体中文',
    note: '每个气泡单独擦除、单独排版，放不下就缩小字号并标出来，方便逐页检查。',
    page: (s) => (
      <Scaled w={560} h={760}>
        <Comic side={s} />
      </Scaled>
    ),
  },
  {
    id: 'ad',
    title: '营销物料与广告',
    body: '海报、横幅、产品宣传图。换成目标语言后版面一眼还能认出来，哪句不满意直接改。',
    from: 'English',
    to: '简体中文',
    note: '每一句译文都能在右侧单独修改，改完导出和原图同样尺寸的 PNG 或 PDF。',
    page: (s) => (
      <Scaled w={560} h={760}>
        <Ad side={s} />
      </Scaled>
    ),
  },
];

function Compare({ c }: { c: Case }) {
  const frame = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  // Each new case opens fully original, then the translation sweeps in to the middle.
  useEffect(() => {
    const state = { p: 100 };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setPos(50);
      return;
    }
    const tween = gsap.to(state, { p: 50, duration: 1.1, ease: 'power3.inOut', delay: 0.15, onUpdate: () => setPos(state.p) });
    return () => {
      tween.kill();
    };
  }, [c.id]);

  const move = (clientX: number) => {
    const r = frame.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={frame}
      className="compare-frame"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div className="compare-layer">{c.page('src')}</div>
      <div className="compare-layer" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        {c.page('dst')}
      </div>
      <span className="compare-label compare-label-l">原文 · {c.from}</span>
      <span className="compare-label compare-label-r">译文 · {c.to}</span>
      <div
        className="compare-handle"
        style={{ left: `${pos}%` }}
        role="slider"
        tabIndex={0}
        aria-label="拖动对比原文和译文"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5));
          if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5));
        }}
      >
        <i>‹ ›</i>
      </div>
    </div>
  );
}

export function Cases({ onSample }: { onSample: () => void }) {
  const [active, setActive] = useState(0);
  const touched = useRef(false);
  const stage = useRef<HTMLDivElement>(null);

  // Gentle auto-advance until the visitor picks a case.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!touched.current) setActive((a) => (a + 1) % CASES.length);
    }, 7000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!stage.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(stage.current, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
  }, [active]);

  const c = CASES[active];
  return (
    <section className="cases" id="cases">
      <div className="section-head reveal">
        <p className="hand-label">use cases</p>
        <h2>适合用在这些地方</h2>
      </div>
      <div className="case-cards" role="tablist" aria-label="使用场景">
        {CASES.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`case-card reveal ${i === active ? 'on' : ''}`}
            onClick={() => {
              touched.current = true;
              setActive(i);
            }}
          >
            <span className="case-no">0{i + 1}</span>
            <strong>{item.title}</strong>
            <span className="case-body">{item.body}</span>
            <span className="case-progress" aria-hidden>
              <i key={`${active}-${i}`} />
            </span>
          </button>
        ))}
      </div>
      <div className="window paper case-window reveal">
        <div className="window-bar">
          <span className="window-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="window-title">
            {c.title} · {active + 1} / {CASES.length}
          </span>
        </div>
        <div className="case-stage" ref={stage}>
          <Compare key={c.id} c={c} />
          <div className="case-side">
            <p className="hand-label">how it looks</p>
            <h3>{c.title}</h3>
            <p>{c.note}</p>
            <p className="case-hint">拖动中间的竖线，对比原文和译文。</p>
            {c.id === 'manual' && (
              <button type="button" className="btn-link" onClick={onSample}>
                用这份示例说明书试一试 →
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
