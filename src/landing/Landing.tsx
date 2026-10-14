import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';
import { DocStage, PAGE_H, PAGE_W, type Phase } from './DocStage';
import { Mark } from './Mark';
import { Cases } from './Cases';
import { Origin } from './Origin';
import './landing.css';

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  onSettings: () => void;
  loading: string | null;
}

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

const CHAPTERS: { phase: Phase; tag: string; title: string; body: string }[] = [
  {
    phase: 'detect',
    tag: 'text, located.',
    title: '识别每一段',
    body: '读取 PDF 的文字层；图片和扫描件里的字用 OCR 找出来。每一段的位置、字号、颜色和对齐方式都会记下来。',
  },
  {
    phase: 'erase',
    tag: 'no patches.',
    title: '干净地擦掉原文',
    body: 'PDF 页面会重新渲染一遍，跳过所有画文字的指令，得到一张没有字的背景。渐变、底纹、压在图上的字，都不会留下色块。',
  },
  {
    phase: 'typeset',
    tag: 'same box, new words.',
    title: '排回原来的位置',
    body: '按段落交给 Claude 或 DeepSeek 翻译，数字、型号和单位保持不变。中日文逐字断行，放不下就自动缩小字号。',
  },
  {
    phase: 'review',
    tag: 'you have the last word.',
    title: '逐段审校，再导出',
    body: '原文和译文左右对照，放不下或识别不准的段落会被标出来。改完导出 PDF 或 PNG。',
  },
];

const FAQS = [
  ['文件会上传到服务器吗？', '不会。解析、OCR 和排版都在你的浏览器里完成，只有需要翻译的文字会发给你选的模型服务商。'],
  ['支持哪些文件？', 'PDF、PNG、JPG 和 WebP，单个 PDF 最多 60 页。电子版 PDF 直接读文字层，扫描件和图片走 OCR。'],
  ['导出的 PDF 能选中文字吗？', '第一版导出的是图片型 PDF：版式和原文完全一致，但文字不能选中。可选中文字的导出在后续计划里。'],
  ['用什么模型翻译？', '在设置里选 Claude（Opus / Sonnet / Haiku 5.5）或 DeepSeek（Flash / V4 Pro）。扫描件和图片还可以打开“AI 识别”，用视觉模型逐行读字。'],
  ['需要付费吗？', 'Recto 本身免费。翻译用你自己的 Claude 或 DeepSeek API Key 计费，开始前页面会先给出费用估算。不填 Key 也能用内置的示例说明书体验完整流程。'],
];

function useCinematic(): boolean {
  const query = '(min-width: 900px) and (prefers-reduced-motion: no-preference)';
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return on;
}

/** Visible window of the frame, as fractions of the viewport. */
type Rect = { t: number; r: number; b: number; l: number };
const HERO: Rect = { t: 0.5, r: 0.035, b: 0.035, l: 0.035 };
const FULL: Rect = { t: 0, r: 0, b: 0, l: 0 };
const HALF: Rect = { t: 0.1, r: 0.035, b: 0.06, l: 0.47 };

const clip = (k: Rect) =>
  `inset(${k.t * 100}vh ${k.r * 100}vw ${k.b * 100}vh ${k.l * 100}vw round 6px)`;

/** Camera transform that centres page point (fx, fy) in the rect, fitted then zoomed. */
function camera(k: Rect, fx: number, fy: number, zoom: number) {
  return () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = vw * (1 - k.l - k.r);
    const h = vh * (1 - k.t - k.b);
    const fit = Math.min((w * 0.86) / PAGE_W, (h * 0.86) / PAGE_H);
    const scale = fit * zoom;
    return {
      x: vw * k.l + w / 2 - fx * scale,
      y: vh * k.t + h / 2 - fy * scale,
      scale,
    };
  };
}

export function Landing({ onFile, onSample, onSettings, loading }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const cinematic = useCinematic();

  // Always open at the top so the intro plays from the start.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, []);

  // Smooth scrolling, wired into ScrollTrigger's clock.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.09 });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  // Drop a file anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) onFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [onFile]);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Scroll read-out in the nav, like a drafting counter.
      ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: (st) => {
          if (progressRef.current) progressRef.current.textContent = st.progress.toFixed(2);
        },
      });

      // Loader: draw the mark, then lift the sheet.
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (!reduce) {
        intro
          .from(q('.loader .mark-path'), { strokeDashoffset: 120, duration: 0.9, stagger: 0.12, ease: 'power2.inOut' })
          .to(q('.loader'), { clipPath: 'inset(0 0 100% 0)', duration: 0.9, ease: 'expo.inOut' }, '+=0.15');
      } else {
        gsap.set(q('.loader'), { display: 'none' });
      }

      const heroTitle = SplitText.create(q('.hero-title'), { type: 'chars', charsClass: 'ch' });
      if (!reduce) {
        intro
          .from(heroTitle.chars, { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.035 }, '-=0.45')
          .from(q('.hero-note'), { opacity: 0, y: 10, duration: 0.6, stagger: 0.15 }, '-=0.6')
          .from(q('.hero-note .draw'), { strokeDashoffset: 200, duration: 0.9, stagger: 0.15, ease: 'power2.out' }, '<')
          .from(q('.hero-sub, .hero-ctas'), { opacity: 0, y: 14, duration: 0.7, stagger: 0.1 }, '-=0.7')
          .from(q('.lp-nav'), { y: -30, opacity: 0, duration: 0.6 }, '-=0.6');
      }

      if (cinematic) {
        const chapters = q('.chapter');
        const titles = chapters.map((c) => SplitText.create(c.querySelector('.chapter-title'), { type: 'chars', charsClass: 'ch' }));
        const zh = q('.ds-live .zh').map((el) => SplitText.create(el, { type: 'chars', charsClass: 'zc' }));
        const zhChars = zh.flatMap((s) => s.chars);

        gsap.set(q('.ds-camera'), camera(HERO, 280, 110, 2.0)());
        // The frame rises into its hero slot once the loader has lifted.
        if (reduce) gsap.set(q('.frame'), { clipPath: clip(HERO) });
        else
          intro.fromTo(
            q('.frame'),
            { clipPath: 'inset(100vh 3.5vw 3.5vh 3.5vw round 6px)' },
            { clipPath: clip(HERO), duration: 1.2, ease: 'expo.out' },
            1.7,
          );
        gsap.set(chapters, { autoAlpha: 0 });
        gsap.set(q('.ds-ghost-wrap'), { autoAlpha: 0, xPercent: 0 });
        gsap.set(zhChars, { opacity: 0, y: 6 });
        gsap.set(q('.rg-box'), { clipPath: 'inset(0 100% 0 0)' });
        gsap.set(q('.ds-scan'), { top: '-4%', opacity: 0 });
        gsap.set(q('.note-path'), { strokeDashoffset: 260 });
        gsap.set(q('.ds-note'), { opacity: 0, y: 8 });

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: q('.story')[0],
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
            invalidateOnRefresh: true,
            onUpdate: (st) => {
              const i = Math.min(3, Math.max(0, Math.floor((st.progress * 10 - 1.4) / 2)));
              q('.chapter-index li').forEach((li, k) => li.classList.toggle('on', st.progress > 0.13 && k === i));
            },
          },
        });

        const cam = (k: Rect, fx: number, fy: number, zoom: number, at: number, dur = 1) => {
          const f = camera(k, fx, fy, zoom);
          tl.to(q('.ds-camera'), { x: () => f().x, y: () => f().y, scale: () => f().scale, duration: dur, ease: 'power2.inOut' }, at);
        };

        const showChapter = (i: number, at: number) => {
          tl.to(chapters[i], { autoAlpha: 1, duration: 0.3 }, at);
          tl.fromTo(chapters[i].querySelector('.chapter-tag'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.4 }, at);
          tl.fromTo(titles[i].chars, { color: 'var(--ghost)' }, { color: 'var(--ink)', stagger: 0.04, duration: 0.2 }, at + 0.05);
          tl.fromTo(chapters[i].querySelector('.chapter-body'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, at + 0.15);
        };
        const hideChapter = (i: number, at: number) => tl.to(chapters[i], { autoAlpha: 0, y: -24, duration: 0.3 }, at);

        // 0 → 1: hero lifts away, the frame opens to full bleed.
        tl.to(q('.hero-copy'), { yPercent: -60, autoAlpha: 0, duration: 0.8, ease: 'power1.in' }, 0)
          .to(q('.frame'), { clipPath: clip(FULL), duration: 1, ease: 'power2.inOut' }, 0);
        cam(FULL, 280, 80, 2.2, 0);
        // 1 → 1.6: frame settles on the right, the page comes into view.
        tl.to(q('.frame'), { clipPath: clip(HALF), duration: 0.8, ease: 'power2.inOut' }, 1);
        cam(HALF, 280, 380, 1, 1, 0.8);
        tl.fromTo(q('.chapter-index'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 1.3);

        // Chapter 1 — detect.
        showChapter(0, 1.5);
        tl.to(q('.ds-scan'), { opacity: 1, duration: 0.1 }, 1.7)
          .to(q('.ds-scan'), { top: '102%', duration: 1.3 }, 1.7)
          .to(q('.ds-live .rg:not(.rg-ocr) .rg-box'), { clipPath: 'inset(0 0% 0 0)', stagger: 0.06, duration: 0.25 }, 1.75)
          .to(q('.ds-live .rg-ocr .rg-box'), { clipPath: 'inset(0 0% 0 0)', stagger: 0.08, duration: 0.25 }, 2.6)
          .to(q('.ds-scan'), { opacity: 0, duration: 0.1 }, 3.0);
        cam(HALF, 280, 590, 1.45, 2.4, 0.9);
        hideChapter(0, 3.3);

        // Chapter 2 — erase.
        showChapter(1, 3.5);
        cam(HALF, 280, 130, 1.55, 3.5, 0.8);
        tl.to(q('.ds-live .en'), { clipPath: 'inset(0 0 0 100%)', stagger: 0.05, duration: 0.35 }, 3.9)
          .to(q('.ds-live .rg-box'), { opacity: 0.35, duration: 0.4 }, 4.6);
        hideChapter(1, 5.3);

        // Chapter 3 — typeset.
        showChapter(2, 5.5);
        cam(HALF, 280, 380, 1, 5.5, 0.8);
        tl.to(zhChars, { opacity: 1, y: 0, stagger: 0.006, duration: 0.12 }, 5.9)
          .to(q('.ds-live .rg-box'), { opacity: 0, duration: 0.4 }, 6.9);
        hideChapter(2, 7.3);

        // Chapter 4 — review, side by side.
        showChapter(3, 7.5);
        tl.to(q('.ds-ghost-wrap'), { autoAlpha: 1, duration: 0.4 }, 7.6)
          .to(q('.ds-ghost-wrap'), { x: -PAGE_W * 0.56, duration: 0.8, ease: 'power2.inOut' }, 7.6)
          .to(q('.ds-live'), { x: PAGE_W * 0.56, duration: 0.8, ease: 'power2.inOut' }, 7.6);
        cam(HALF, 280, 380, 0.52, 7.6, 0.8);
        tl.to(q('.note-path'), { strokeDashoffset: 0, duration: 0.6, stagger: 0.2 }, 8.4)
          .to(q('.ds-note'), { opacity: 1, y: 0, duration: 0.4, stagger: 0.2 }, 8.5)
          .to({}, { duration: 0.8 }, 9.2);
      }

      // Reveal-on-enter for the remaining sections.
      ScrollTrigger.batch(q('.reveal'), {
        start: 'top 85%',
        onEnter: (els) => gsap.fromTo(els, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out', overwrite: true }),
      });

      // Stats count up.
      q('.stat-num').forEach((el) => {
        const end = Number(el.dataset.value);
        const obj = { v: 0 };
        gsap.to(obj, {
          v: end,
          duration: 1.4,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 85%' },
          onUpdate: () => (el.textContent = String(Math.round(obj.v))),
        });
      });

      if (!reduce) {
        // Section titles ink in letter by letter as they scroll into view.
        q('.ink-title').forEach((title) => {
          const split = SplitText.create(title, { type: 'chars', charsClass: 'ch' });
          gsap.fromTo(
            split.chars,
            { color: 'var(--ghost)' },
            { color: 'var(--ink)', stagger: 0.08, ease: 'none', scrollTrigger: { trigger: title, start: 'top 85%', end: 'top 50%', scrub: true } },
          );
        });

        // Big closing line inks in letter by letter.
        const cta = SplitText.create(q('.cta-title'), { type: 'chars', charsClass: 'ch' });
        gsap.fromTo(
          cta.chars,
          { color: 'var(--ghost)' },
          { color: 'var(--ink)', stagger: 0.08, ease: 'none', scrollTrigger: { trigger: q('.cta-title')[0], start: 'top 85%', end: 'top 45%', scrub: true } },
        );
        q('.draw-on-view').forEach((p) =>
          gsap.fromTo(p, { strokeDashoffset: 220 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', scrollTrigger: { trigger: p, start: 'top 85%' } }),
        );
      }
    },
    { scope: root, dependencies: [cinematic], revertOnUpdate: true },
  );

  const pick = () => input.current?.click();

  return (
    <div ref={root} className={`lp ${cinematic ? 'is-cinematic' : 'is-simple'}`}>
      <div className="loader" aria-hidden>
        <Mark size={72} />
      </div>

      <header className="lp-nav">
        <div className="lp-brand">
          <Mark size={26} />
          <span className="wordmark">Recto</span>
          <span className="lp-progress" ref={progressRef}>
            0.00
          </span>
        </div>
        <nav className="lp-links">
          <button type="button" className="lp-link" onClick={onSample} disabled={!!loading}>
            试试示例
          </button>
          <button type="button" className="lp-link" onClick={onSettings}>
            设置 API
          </button>
          <button type="button" className="btn-primary" onClick={pick} disabled={!!loading}>
            上传文件
          </button>
        </nav>
      </header>

      <section className="story">
        <div className="story-sticky">
          <div className="hero-copy">
            <p className="hero-note hero-note-a">
              layout-preserving
              <svg viewBox="0 0 120 40" aria-hidden>
                <path className="draw" d="M4 30 C 40 34, 80 30, 112 8 M100 6 L113 7 L109 19" />
              </svg>
            </p>
            <h1 className="hero-title">换一种语言，版式一点不变。</h1>
            <p className="hero-note hero-note-b">
              <svg viewBox="0 0 60 30" aria-hidden>
                <path className="draw" d="M4 22 C 20 24, 34 20, 52 8 M44 6 L53 8 L50 17" />
              </svg>
              <s>重新排版</s> 原样排回
            </p>
            <p className="hero-sub">上传说明书、传单或截图，翻译后每一段文字都回到原来的位置。</p>
            <div className="hero-ctas">
              <button type="button" className="btn-primary btn-lg" onClick={pick} disabled={!!loading}>
                上传文件
              </button>
              <button type="button" className="btn-ghost btn-lg" onClick={onSample} disabled={!!loading}>
                试试示例说明书
              </button>
              {loading && (
                <span className="hero-loading">
                  <span className="spinner" aria-hidden /> {loading}
                </span>
              )}
            </div>
          </div>

          {cinematic && (
            <>
              <div className="frame">
                <DocStage />
                <p className="frame-caption">Recto · 一页说明书的翻译过程</p>
              </div>
              <div className="chapters">
                {CHAPTERS.map((c, i) => (
                  <article key={c.phase} className="chapter">
                    <p className="chapter-label">
                      <span className="chapter-no">{i + 1}</span>
                      <span className="chapter-tag">{c.tag}</span>
                    </p>
                    <h2 className="chapter-title">{c.title}</h2>
                    <p className="chapter-body">{c.body}</p>
                  </article>
                ))}
              </div>
              <ol className="chapter-index" aria-hidden>
                {CHAPTERS.map((c, i) => (
                  <li key={c.phase}>0{i + 1}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>

      {!cinematic && (
        <section className="simple-chapters">
          {CHAPTERS.map((c, i) => (
            <article key={c.phase} className="simple-chapter reveal">
              <p className="chapter-label">
                <span className="chapter-no">{i + 1}</span>
                <span className="chapter-tag">{c.tag}</span>
              </p>
              <h2 className="chapter-title">{c.title}</h2>
              <p className="chapter-body">{c.body}</p>
              <div className="simple-stage">
                <DocStage phase={c.phase} />
              </div>
            </article>
          ))}
        </section>
      )}

      <Origin />

      <Cases onSample={onSample} />

      <section className="stats">
        {[
          [16, '种语言', '中日韩、欧洲主要语言、阿拉伯语'],
          [3, '种识别方式', '文字层 · 整页 OCR · 两者结合'],
          [0, '台服务器', '文件只在你的浏览器里处理'],
        ].map(([n, unit, note]) => (
          <div key={unit as string} className="stat reveal">
            <p className="stat-line">
              <span className="stat-num" data-value={n}>
                {n}
              </span>
              <span className="stat-unit">{unit}</span>
            </p>
            <p className="stat-note">{note}</p>
          </div>
        ))}
      </section>

      <section className="faq">
        <div className="section-head reveal">
          <p className="hand-label">faqs</p>
          <h2>常见问题</h2>
        </div>
        <div className="faq-list">
          {FAQS.map(([q, a]) => (
            <details key={q} className="faq-item reveal">
              <summary>
                {q}
                <i aria-hidden />
              </summary>
              <div className="faq-a">
                <p>{a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="cta">
        <p className="hand-label cta-note">
          your turn
          <svg viewBox="0 0 90 40" aria-hidden>
            <path className="draw-on-view" d="M4 8 C 30 4, 60 14, 80 32 M70 33 L81 33 L80 22" />
          </svg>
        </p>
        <h2 className="cta-title">把文件拖进来。</h2>
        <div className="window paper cta-window reveal">
          <div className="window-bar">
            <span className="window-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="window-title">新建翻译</span>
          </div>
          <div className="drop-body">
            {loading ? (
              <p className="drop-loading">
                <span className="spinner" aria-hidden /> {loading}
              </p>
            ) : (
              <>
                <p className="drop-title">拖到页面任意位置，或者</p>
                <div className="drop-actions">
                  <button type="button" className="btn-primary" onClick={pick}>
                    选择文件
                  </button>
                  <button type="button" className="btn-ghost" onClick={onSample}>
                    用示例说明书
                  </button>
                </div>
                <p className="drop-note">PDF · PNG · JPG · WebP ｜ 单个 PDF 最多 60 页</p>
              </>
            )}
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <span className="wordmark">Recto</span>
        <span>保留版式的文档翻译 · 作品集项目 · 2026</span>
      </footer>

      {dragging && (
        <div className="drag-veil" aria-hidden>
          <p>松开即可打开文件</p>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
