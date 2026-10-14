import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './landing/Landing';
import { Mark } from './landing/Mark';
import { PageView, type View } from './components/PageView';
import { RegionPanel } from './components/RegionPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Thumbs } from './components/Thumbs';
import { AUTO_SOURCE, LANGS } from './lib/langs';
import {
  contextFrom,
  liveIssues,
  loadDocument,
  ocrKey,
  pageChars,
  prepareRegions,
  resolveMode,
  translateRegions,
  withOverflow,
} from './lib/pipeline';
import { activeKey, activeModel, loadSettings, saveSettings } from './lib/settings';
import { createTranslator, DemoTranslator, estimateCostUsd, type Translator } from './lib/translate';
import { aiOcrCostPerPage, createAiReader, type AiReader } from './lib/aiocr';
import type { OcrStage } from './lib/ocr';
import type { Doc, ModeChoice, Page, Region, Settings } from './lib/types';
import sampleDict from './lib/sample-dict.json';

const MODE_OPTIONS: { value: ModeChoice; label: string }[] = [
  { value: 'auto', label: '自动推荐' },
  { value: 'text', label: '仅文字层' },
  { value: 'smart', label: '文字层 + 图片内文字' },
  { value: 'image', label: '整页 OCR' },
];

const SAMPLE_NAME = 'AquaBrew-SK200-manual.pdf';

function ocrStatus(stage: OcrStage, p: number): string {
  const pct = Math.round(p * 100);
  if (stage === 'download') return `下载识别语言包 ${pct}%（首次使用需要下载）`;
  if (stage === 'ai') return `AI 正在识别文字 ${pct}%`;
  return `识别图片中的文字 ${pct}%`;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [doc, setDocState] = useState<Doc | null>(null);
  const docRef = useRef<Doc | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('translated');
  const [showBoxes, setShowBoxes] = useState(true);
  const [loading, setLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ reason?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setDoc = useCallback((next: Doc | null) => {
    // Landing and workspace are different views; start each at the top.
    if (!!next !== !!docRef.current) window.scrollTo(0, 0);
    docRef.current = next;
    setDocState(next);
  }, []);

  const patchPage = useCallback(
    (index: number, fn: (p: Page) => Page) => {
      const d = docRef.current;
      if (!d) return;
      const pages = [...d.pages];
      pages[index] = { ...fn(pages[index]), revision: pages[index].revision + 1 };
      setDoc({ ...d, pages });
    },
    [setDoc],
  );

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  // ---------- Loading ----------
  async function open(file: Blob, name: string, isSample = false) {
    setError(null);
    setLoading('正在读取文件…');
    try {
      const d = await loadDocument(file, name, (done, total) => setLoading(`正在分析版面：第 ${done} / ${total} 页`));
      d.isSample = isSample;
      d.pages = d.pages.map((p) => ({ ...p, mode: resolveMode(p, settings.mode) }));
      setDoc(d);
      setCurrent(0);
      setSelected(null);
      setView('translated');
    } catch (e) {
      setError(e instanceof Error ? `无法打开文件：${e.message}` : '无法打开文件。');
    } finally {
      setLoading(null);
    }
  }

  async function openSample() {
    setLoading('正在载入示例…');
    const res = await fetch(`${import.meta.env.BASE_URL}sample/aquabrew-sk200-manual.pdf`);
    await open(await res.blob(), SAMPLE_NAME, true);
  }

  // ---------- Translation ----------
  function makeTranslator(): Translator | null {
    const configured = createTranslator(settings);
    if (configured) return configured;
    if (docRef.current?.isSample) return new DemoTranslator(sampleDict as Record<string, string>);
    setDialog({ reason: '翻译你自己的文件需要填写 API Key（Claude 或 DeepSeek 任选其一）。也可以先用示例文档体验演示模式。' });
    return null;
  }

  const demo = !activeKey(settings) && !!doc?.isSample;
  const aiReader = useMemo(() => createAiReader(settings), [settings]);

  /** The AI reader when AI reading is on; false (and a prompt) when it is on but has no key. */
  function resolveAi(): AiReader | null | false {
    if (!settings.aiOcr) return null;
    if (aiReader) return aiReader;
    if (docRef.current?.isSample) return null;
    setDialog({ reason: 'AI 识别需要 API Key：Claude 任一模型，或 DeepSeek（识别时固定用 deepseek-flash）。' });
    return false;
  }

  async function translatePages(indices: number[]) {
    const translator = makeTranslator();
    if (!translator) return;
    const ai = resolveAi();
    if (ai === false) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    try {
      for (const [k, i] of indices.entries()) {
        if (ac.signal.aborted) break;
        const prefix = indices.length > 1 ? `第 ${k + 1} / ${indices.length} 页：` : '';
        const page = docRef.current!.pages[i];
        const mode = resolveMode(page, settings.mode);
        patchPage(i, (p) => ({ ...p, mode, status: 'analyzing', error: undefined }));
        if (mode !== 'text') setBusy(`${prefix}识别图片中的文字…`);
        const { regions, ocr } = await prepareRegions(
          { ...docRef.current!.pages[i], mode },
          mode,
          settings.sourceLang,
          docRef.current!,
          (stage, p) => setBusy(`${prefix}${ocrStatus(stage, p)}`),
          ai,
          ac.signal,
        );
        patchPage(i, (p) => ({ ...p, regions, ocr, status: 'translating' }));
        setBusy(`${prefix}翻译中…`);
        const translated = await translateRegions(regions, translator, {
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          glossary: settings.glossary,
          context: contextFrom(i > 0 ? docRef.current!.pages[i - 1] : undefined),
          signal: ac.signal,
        });
        patchPage(i, (p) => ({ ...p, regions: withOverflow(p, translated, settings.targetLang), status: 'done' }));
      }
    } catch (e) {
      const message = ac.signal.aborted ? '已取消。' : e instanceof Error ? e.message : '翻译失败。';
      const failed = docRef.current?.pages.findIndex((p) => p.status === 'analyzing' || p.status === 'translating') ?? -1;
      if (failed >= 0) patchPage(failed, (p) => ({ ...p, status: ac.signal.aborted ? 'ready' : 'error', error: message }));
      if (!ac.signal.aborted) setError(message);
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  /** Runs OCR without translating, so the user can review detected text and cost first. */
  async function detectPage(i: number) {
    const ai = resolveAi();
    if (ai === false) return;
    setError(null);
    try {
      const page = docRef.current!.pages[i];
      const mode = resolveMode(page, settings.mode);
      patchPage(i, (p) => ({ ...p, mode, status: 'analyzing' }));
      setBusy('识别图片中的文字…');
      const { regions, ocr } = await prepareRegions(
        { ...page, mode },
        mode,
        settings.sourceLang,
        docRef.current!,
        (stage, p) => setBusy(ocrStatus(stage, p)),
        ai,
      );
      patchPage(i, (p) => ({ ...p, regions, ocr, status: 'ready' }));
    } catch (e) {
      patchPage(i, (p) => ({ ...p, status: 'error' }));
      setError(e instanceof Error ? `识别失败：${e.message}` : '识别失败。');
    } finally {
      setBusy(null);
    }
  }

  async function retranslateRegion(id: string) {
    const translator = makeTranslator();
    if (!translator) return;
    setBusy('重新翻译这一段…');
    try {
      const page = docRef.current!.pages[current];
      const regions = await translateRegions(
        page.regions,
        translator,
        { sourceLang: settings.sourceLang, targetLang: settings.targetLang, glossary: settings.glossary, context: contextFrom(page) },
        new Set([id]),
      );
      patchPage(current, (p) => ({ ...p, regions: withOverflow(p, regions, settings.targetLang) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败。');
    } finally {
      setBusy(null);
    }
  }

  function changeRegion(id: string, patch: Partial<Region>) {
    patchPage(current, (p) => ({
      ...p,
      regions: withOverflow(
        p,
        p.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        settings.targetLang,
      ),
    }));
  }

  // Changing the target language invalidates existing translations.
  function changeTarget(targetLang: string) {
    updateSettings({ ...settings, targetLang });
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      pages: d.pages.map((p) => ({
        ...p,
        regions: p.regions.map((r) => ({ ...r, translation: undefined, edited: false, overflow: false })),
        status: p.status === 'done' || p.status === 'error' ? 'ready' : p.status,
        revision: p.revision + 1,
      })),
    });
  }

  function changeMode(mode: ModeChoice) {
    updateSettings({ ...settings, mode });
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      pages: d.pages.map((p) => {
        const m = resolveMode(p, mode);
        if (m === p.mode) return p;
        const keep = new Map(p.regions.map((r) => [r.id, r]));
        const regions = m === 'text' ? p.native.map((r) => keep.get(r.id) ?? r) : p.regions;
        const allDone = m === 'text' && regions.every((r) => !r.translate || r.translation);
        return { ...p, mode: m, regions, status: allDone && p.status === 'done' ? 'done' : 'ready', revision: p.revision + 1 };
      }),
    });
  }

  async function doExportPdf() {
    const d = docRef.current;
    if (!d) return;
    setBusy('正在生成 PDF…');
    try {
      const { download, exportName, exportPdf } = await import('./lib/export');
      const blob = await exportPdf(d, settings.targetLang, (n) => setBusy(`正在生成 PDF：${n} / ${d.pages.length} 页`));
      download(blob, exportName(d, settings.targetLang, 'pdf'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败。');
    } finally {
      setBusy(null);
    }
  }

  async function doExportPng() {
    const d = docRef.current;
    if (!d) return;
    const { download, exportName, exportPng } = await import('./lib/export');
    const blob = await exportPng(d.pages[current], settings.targetLang);
    download(blob, exportName(d, settings.targetLang, 'png', d.kind === 'pdf' ? current + 1 : undefined));
  }

  // ---------- Derived ----------
  const page = doc?.pages[current];
  const issues = useMemo(() => (page ? liveIssues(page) : []), [page]);
  const pending = useMemo(() => (doc ? doc.pages.flatMap(pageChars) : []), [doc]);
  const anyOcrPending = !!doc?.pages.some((p) => {
    const m = resolveMode(p, settings.mode);
    return m !== 'text' && p.ocr?.key !== ocrKey(p, m, settings.sourceLang, doc!, aiReader);
  });
  const ocrPagesPending = doc?.pages.filter((p) => {
    const m = resolveMode(p, settings.mode);
    return m !== 'text' && p.ocr?.key !== ocrKey(p, m, settings.sourceLang, doc!, aiReader);
  }).length ?? 0;
  const estimate =
    (pending.length ? estimateCostUsd(activeModel(settings), pending) : 0) + (aiReader ? ocrPagesPending * aiOcrCostPerPage(settings) : 0);
  const translatedCount = doc?.pages.filter((p) => p.status === 'done').length ?? 0;
  const hasTranslations = !!doc?.pages.some((p) => p.regions.some((r) => r.translation));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!docRef.current || (e.target as HTMLElement).closest('textarea, input, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setCurrent((c) => Math.min(docRef.current!.pages.length - 1, c + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCurrent((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${doc ? 'app-fixed' : ''}`}>
      {doc && (
      <header className="topbar">
        <button type="button" className="brand" onClick={() => !busy && setDoc(null)} title="回到首页">
          <Mark size={26} />
          <span className="wordmark">Recto</span>
        </button>
        {doc && <span className="docname" title={doc.name}>{doc.name}</span>}
        <div className="topbar-controls">
          <label className="ctl">
            <span>原文</span>
            <select value={settings.sourceLang} onChange={(e) => updateSettings({ ...settings, sourceLang: e.target.value })}>
              <option value={AUTO_SOURCE}>自动识别</option>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <span className="arrow" aria-hidden>
            →
          </span>
          <label className="ctl">
            <span>译文</span>
            <select value={settings.targetLang} onChange={(e) => changeTarget(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          {doc?.kind === 'pdf' && (
            <label className="ctl">
              <span>识别方式</span>
              <select value={settings.mode} onChange={(e) => changeMode(e.target.value as ModeChoice)}>
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="topbar-actions">
          {doc && (
            <>
              <span className="estimate" title="按字数估算的 API 费用，实际以 Anthropic 账单为准">
                {demo ? '演示模式 · 免费' : pending.length || (aiReader && ocrPagesPending) ? `约 $${estimate < 0.01 ? '<0.01' : estimate.toFixed(2)}${anyOcrPending ? ' 起' : ''}` : ''}
              </span>
              <button type="button" className="btn-primary" disabled={!!busy} onClick={() => translatePages(doc.pages.map((_, i) => i))}>
                {translatedCount === doc.pages.length ? '补译新内容' : `翻译${doc.pages.length > 1 ? '全部' : ''}`}
              </button>
              <div className="menu">
                <button type="button" className="btn-ghost" disabled={!!busy || !hasTranslations}>
                  导出 ▾
                </button>
                <div className="menu-list">
                  <button type="button" onClick={doExportPdf}>
                    导出 PDF（全部页面）
                  </button>
                  <button type="button" onClick={doExportPng}>
                    导出当前页 PNG
                  </button>
                </div>
              </div>
            </>
          )}
          <button type="button" className="btn-icon" onClick={() => setDialog({})} aria-label="设置" title="设置">
            ⚙
          </button>
        </div>
      </header>
      )}

      {!doc || !page ? (
        <Landing onFile={(f) => open(f, f.name)} onSample={openSample} onSettings={() => setDialog({})} loading={loading} />
      ) : (
        <div className={`workspace ${doc.pages.length > 1 ? '' : 'workspace-single'}`}>
          {doc.pages.length > 1 && <Thumbs pages={doc.pages} current={current} onPick={(i) => { setCurrent(i); setSelected(null); }} />}
          <section className="stage">
            <div className="stage-bar">
              <div className="seg" role="tablist" aria-label="视图">
                {(
                  [
                    ['translated', '译文'],
                    ['source', '原文'],
                    ['compare', '对照'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={showBoxes} aria-label="显示文字框" onChange={(e) => setShowBoxes(e.target.checked)} />
                显示文字框
              </label>
              <span className="spacer" />
              {demo && <span className="pill">演示模式：内置简体中文译文，填入 API Key 后可真实翻译</span>}
              {page.mode !== 'text' && page.status === 'ready' && page.ocr?.key !== ocrKey(page, page.mode, settings.sourceLang, doc, aiReader) && (
                <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => detectPage(current)}>
                  先识别文字
                </button>
              )}
              {page.status !== 'done' && (
                <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => translatePages([current])}>
                  只翻译本页
                </button>
              )}
            </div>
            <div className="stage-scroll">
              <PageView key={current} page={page} lang={settings.targetLang} view={view} showBoxes={showBoxes} selectedId={selected} onSelect={setSelected} />
            </div>
          </section>
          <RegionPanel
            page={page}
            issues={issues}
            selectedId={selected}
            busy={!!busy}
            onSelect={setSelected}
            onChange={changeRegion}
            onRetranslate={retranslateRegion}
          />
        </div>
      )}

      {(busy || error) && (
        <div className={`toast ${error && !busy ? 'toast-error' : ''}`} role="status">
          {busy ? (
            <>
              <span className="spinner" aria-hidden /> {busy}
              {abortRef.current && (
                <button type="button" className="btn-mini" onClick={() => abortRef.current?.abort()}>
                  取消
                </button>
              )}
            </>
          ) : (
            <>
              {error}
              <button type="button" className="btn-mini" onClick={() => setError(null)}>
                关闭
              </button>
            </>
          )}
        </div>
      )}

      <SettingsDialog
        open={!!dialog}
        reason={dialog?.reason}
        settings={settings}
        onClose={() => setDialog(null)}
        onSave={(s) => {
          updateSettings(s);
          setDialog(null);
        }}
      />
    </div>
  );
}
