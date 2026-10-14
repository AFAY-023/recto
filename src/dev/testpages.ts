// Dev-only fixtures: synthetic scanned pages for checking line detection and OCR.
// Not imported by the app; load from the browser console via import('/src/dev/testpages.ts').

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function page(width = 2480, height = 3508, paper = '#f3f2ef') {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d')!;
  x.fillStyle = paper;
  x.fillRect(0, 0, width, height);
  return { c, x };
}

function noise(c: HTMLCanvasElement, seed: number, amount = 20) {
  const rnd = seeded(seed);
  const x = c.getContext('2d')!;
  const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    id.data[i] += n;
    id.data[i + 1] += n;
    id.data[i + 2] += n;
  }
  x.putImageData(id, 0, 0);
}

const MINCHO = '"Yu Mincho","MS Mincho","Yu Gothic",serif';
const GOTHIC = '"Yu Gothic","Meiryo","Microsoft YaHei",sans-serif';

/** Table of contents with dot leaders, ruby, page numbers and faint artwork. */
export function tocPage() {
  const { c, x } = page();
  const S = 2;
  x.strokeStyle = 'rgba(0,0,0,0.12)';
  x.lineWidth = 6;
  for (let i = 0; i < 6; i++) {
    x.beginPath();
    x.arc(500 + i * 300, 600 + (i % 2) * 900, 160, 0, 7);
    x.stroke();
  }
  x.fillStyle = '#111';
  x.font = `bold ${30 * S}px "Microsoft YaHei"`;
  x.fillText('目　录', 560 * S, 190 * S);
  const toc = [
    ['I．日本語の　発音（日语的发音）', '2'],
    ['II．教室の　ことば（课堂用语）', '5'],
    ['III．毎日の　あいさつと　会話表現（日常问候和会话）', '5'],
    ['IV．数字（数字）', '5'],
  ];
  x.font = `${15 * S}px ${MINCHO}`;
  x.fillText('はじめに（导入部分）', 125 * S, 275 * S);
  toc.forEach(([t, p], i) => {
    const y = (305 + i * 30) * S;
    x.font = `${15 * S}px ${MINCHO}`;
    x.fillText(t, 125 * S, y);
    let dx = 125 * S + x.measureText(t).width + 10;
    while (dx < 720 * S) {
      x.fillText('.', dx, y);
      dx += 8 * S;
    }
    x.fillText(p, 735 * S, y);
    x.font = `${7 * S}px ${MINCHO}`;
    x.fillText('にほんご', 160 * S, y - 16 * S);
  });
  const lessons: [string, string, string[]][] = [
    ['第1課', '6', ['1．わたしは　マイク・ミラーです。', '2．サントスさんは　学生じゃ　ありません。', '3．ミラーさんは　会社員ですか。', '4．サントスさんも　会社員です。', '会話：初めまして']],
    ['第2課', '18', ['1．これは　辞書です。', '2．それは　わたしの　傘です。', '3．この　本は　わたしのです。', '会話：これから　お世話に　なります']],
  ];
  let y = 455;
  for (const [t, p, items] of lessons) {
    x.fillStyle = '#bbb';
    x.fillRect(125 * S, (y - 25) * S, 90 * S, 40 * S);
    x.fillStyle = '#111';
    x.font = `bold ${19 * S}px ${GOTHIC}`;
    x.fillText(t, 135 * S, (y + 3) * S);
    x.font = `${15 * S}px ${MINCHO}`;
    let dx = 220 * S;
    while (dx < 720 * S) {
      x.fillText('.', dx, y * S);
      dx += 8 * S;
    }
    x.fillText(p, 735 * S, y * S);
    y += 35;
    for (const it of items) {
      x.font = `${15 * S}px ${MINCHO}`;
      x.fillText(it, 220 * S, y * S);
      x.font = `${7 * S}px ${MINCHO}`;
      x.fillText('がくせい', 380 * S, (y - 16) * S);
      y += 29;
    }
    y += 40;
  }
  noise(c, 5);
  return {
    canvas: c,
    expect: ['目录', 'はじめに', '日本語の', '発音', '教室の', 'ことば', 'あいさつと', '会話表現', '数字', '第1課', 'わたしは', 'マイク・ミラーです', 'サントスさんは', 'ありません', 'ミラーさんは', '会社員ですか', '初めまして', '第2課', '辞書です', 'わたしの', '本は', 'お世話に'],
  };
}

/** Cast page: portraits, katakana names, ruby, show-through from the back page. */
export function castPage() {
  const { c, x } = page(1240, 1754, '#f2f1ee');
  x.fillStyle = 'rgba(0,0,0,0.10)';
  x.font = '17px SimSun, serif';
  for (let i = 0; i < 30; i++) x.fillText('1. 足够例题 这是背面透过来的文字 练习 问题 ' + i, 560, 220 + i * 42);
  x.fillStyle = '#111';
  x.font = 'bold 30px "Microsoft YaHei", sans-serif';
  x.fillText('登场人物', 540, 150);
  const people = [
    ['マイク・ミラー', 'アメリカ、IMCの 社員', 'しゃいん'],
    ['佐藤 けい子', '日本、IMCの 社員', 'しゃいん'],
    ['ジョゼ・サントス', 'ブラジル、ブラジルエアーの 社員', 'しゃいん'],
    ['マリア・サントス', 'ブラジル、主婦', 'しゅふ'],
    ['カリナ', 'インドネシア、富士大学の 学生', 'がくせい'],
    ['ワン・シュエ', '中国、神戸病院の 医者', 'いしゃ'],
    ['山田 一郎', '日本、IMCの 社員', 'しゃいん'],
    ['山田 友子', '日本、銀行員', 'ぎんこういん'],
  ];
  people.forEach(([n, d, f], i) => {
    const cx = 320 + (i % 2) * 560;
    const cy = 380 + Math.floor(i / 2) * 360;
    x.strokeStyle = '#111';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(cx, cy - 120, 70, 0, 7);
    x.stroke();
    x.beginPath();
    x.arc(cx - 22, cy - 130, 6, 0, 7);
    x.arc(cx + 22, cy - 130, 6, 0, 7);
    x.fill();
    x.textAlign = 'center';
    x.font = `bold 22px ${GOTHIC}`;
    x.fillText(n, cx, cy);
    x.font = `18px ${GOTHIC}`;
    x.fillText(d, cx, cy + 38);
    const w = x.measureText(d).width;
    x.font = `10px ${GOTHIC}`;
    x.fillText(f, cx + w / 2 - 28, cy + 16);
    x.textAlign = 'left';
  });
  noise(c, 11, 22);
  return {
    canvas: c,
    expect: ['登场人物', 'マイク・ミラー', 'アメリカ', 'IMCの', '社員', '佐藤', 'けい子', 'ジョゼ・サントス', 'ブラジルエアーの', 'マリア・サントス', '主婦', 'カリナ', 'インドネシア', '富士大学の', '学生', 'ワン・シュエ', '神戸病院の', '医者', '山田', '一郎', '友子', '銀行員'],
  };
}

/** Chinese imprint page with small print and a spaced-out label column. */
export function imprintPage() {
  const { c, x } = page(1240, 1754, '#f4f2ec');
  x.fillStyle = '#222';
  x.font = 'bold 18px SimSun, serif';
  x.fillText('京权图字：01-2016-4116', 150, 180);
  x.font = '17px "Times New Roman", serif';
  x.fillText('Minna no Nihongo Shokyu I Dai 2-Han Hyojun Mondaishu', 150, 230);
  x.fillText('© 1999 3A Corporation', 150, 254);
  x.fillText('PUBLISHED WITH KIND PERMISSION OF 3A CORPORATION, TOKYO, JAPAN', 150, 278);
  x.font = 'bold 18px SimSun, serif';
  x.fillText('图书在版编目（CIP）数据', 150, 340);
  x.font = '17px SimSun, serif';
  x.fillText('大家的日语初级 1 标准习题集：第二版 / 日本 3A 出版社编著. — 北京：外语', 150, 390);
  x.fillText('教学与研究出版社，2017.4（2017.7 重印）', 150, 416);
  x.fillText('ISBN 978-7-5135-8783-9', 150, 442);
  x.fillText('中国版本图书馆 CIP 数据核字（2017）第 079133 号', 150, 520);
  const rows = [
    ['出 版 人', '蔡剑峰'],
    ['责任编辑', '杜红坡'],
    ['封面设计', '孙莉明'],
    ['出版发行', '外语教学与研究出版社'],
    ['社　　址', '北京市西三环北路 19 号（100089）'],
    ['网　　址', 'http://www.fltrp.com'],
    ['开　　本', '787×1092　1/16'],
    ['版　　次', '2017 年 5 月第 1 版　2017 年 7 月第 2 次印刷'],
    ['定　　价', '16.00 元'],
  ];
  x.font = '16px "Microsoft YaHei", sans-serif';
  rows.forEach(([a, b], i) => {
    x.fillText(a, 150, 980 + i * 30);
    x.fillText(b, 260, 980 + i * 30);
  });
  noise(c, 7, 24);
  return {
    canvas: c,
    expect: ['京权图字', '01-2016-4116', 'Minna', 'PUBLISHED', '图书在版编目', '大家的日语初级', '外语教学与研究出版社', '2017.7', '978-7-5135-8783-9', '079133', '出版人', '责任编辑', '封面设计', '出版发行', '社址', '网址', '开本', '版次', '定价', '蔡剑峰', '杜红坡', '孙莉明', '北京市西三环北路', '100089', 'fltrp.com', '787', '1/16', '第2次印刷', '16.00元'],
  };
}

/** Draws detected lines (red) and ruby (blue) over a page, for eyeballing. */
export async function showLines(canvas: HTMLCanvasElement) {
  const { detectLines } = await import('../lib/lines');
  const t0 = performance.now();
  const lines = detectLines(canvas);
  const ms = Math.round(performance.now() - t0);
  const o = document.createElement('canvas');
  o.width = canvas.width / 2;
  o.height = canvas.height / 2;
  const ox = o.getContext('2d')!;
  ox.drawImage(canvas, 0, 0, o.width, o.height);
  ox.lineWidth = 2;
  for (const l of lines) {
    ox.strokeStyle = '#e00';
    ox.strokeRect(l.x0 / 2, l.y0 / 2, (l.x1 - l.x0) / 2, (l.y1 - l.y0) / 2);
    ox.strokeStyle = '#08f';
    for (const r of l.ruby) ox.strokeRect(r.x0 / 2, r.y0 / 2, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2);
  }
  document.body.innerHTML = '';
  document.body.style.background = '#fff';
  o.style.width = '100%';
  document.body.append(o);
  return { ms, lines: lines.length, ruby: lines.reduce((a, l) => a + l.ruby.length, 0) };
}

/** Runs the OCR pipeline on a page and scores it against the expected strings. */
export async function score(canvas: HTMLCanvasElement, expect: string[], sourceLang = 'auto') {
  const { ocrPage } = await import('../lib/ocr');
  const { ocrLangs } = await import('../lib/langs');
  const langs = ocrLangs(sourceLang, undefined);
  const width = 595.28;
  const t0 = performance.now();
  const regions = await ocrPage({ width, height: (width * canvas.height) / canvas.width, index: 0 } as never, canvas, { langs, sourceLang }, 't');
  const flat = regions.map((r) => r.text).join('').replace(/\s/g, '');
  const miss = expect.filter((e) => !flat.includes(e.replace(/\s/g, '')));
  return {
    langs: langs.label,
    hit: `${expect.length - miss.length}/${expect.length}`,
    ms: Math.round(performance.now() - t0),
    miss: miss.join(' '),
    regions: regions.map((r) => r.text),
  };
}

/**
 * Replaces DeepSeek calls with canned replies: vision OCR answers with the
 * given transcription per box number (or a placeholder), translation echoes
 * the source prefixed with 译. Lets the AI path be exercised without a key.
 */
export function mockDeepSeek(read: (n: number) => { text: string; kind: 'text' | 'number' | 'noise' } = (n) => ({ text: `第${n}行原文`, kind: 'text' })) {
  const calls: Record<string, unknown>[] = [];
  const real = window.fetch.bind(window);
  window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('api.deepseek.com')) return real(url, init);
    const body = JSON.parse(String(init?.body));
    const user = body.messages.find((m: { role: string }) => m.role === 'user');
    let content: string;
    if (Array.isArray(user.content)) {
      const text = user.content.find((c: { type: string }) => c.type === 'text').text as string;
      const nums = text.match(/Line numbers on this image:([\d, ]+)\./)![1].split(',').map((n) => +n.trim());
      calls.push({ kind: 'ocr', boxes: nums.length, model: body.model, imageKB: Math.round((user.content[0].image_url.url.length * 0.75) / 1024) });
      content = JSON.stringify({ lines: nums.map((n) => ({ n, ...read(n) })) });
    } else {
      const segs = JSON.parse((user.content as string).split('Segments:\n')[1]) as { id: string; text: string }[];
      calls.push({ kind: 'translate', segments: segs.length, model: body.model });
      content = JSON.stringify({ segments: segs.map((s) => ({ id: s.id, translation: '译' + s.text.replace('原文', '') })) });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

/** Opens a canvas in the app as if the user dropped a PNG. */
export async function dropCanvas(canvas: HTMLCanvasElement, name = 'scan.png') {
  const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([png], name, { type: 'image/png' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}

/** The page object the region panel is showing (read from React's fiber). */
export function currentPage() {
  const el = document.querySelector('.panel-head') as (Element & Record<string, unknown>) | null;
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber'));
  let f = key ? (el![key] as { memoizedProps?: { page?: unknown }; return?: unknown } | null) : null;
  while (f && !f.memoizedProps?.page) f = f.return as typeof f;
  return f?.memoizedProps?.page as import('../lib/types').Page | undefined;
}
