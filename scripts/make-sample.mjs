// Generates the bundled sample manual (public/sample/) and the offline
// translation table used by demo mode (src/lib/sample-dict.json).
// Run: npm run sample
import { writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const T = {
  brand: ['AquaBrew', 'AquaBrew'],
  title: ['Smart Kettle SK-200', '智能电水壶 SK-200'],
  subtitle: ['User Manual', '使用说明书'],
  intro: [
    'Thank you for choosing the AquaBrew Smart Kettle. Please read this manual carefully before first use and keep it for future reference.',
    '感谢您选择 AquaBrew 智能电水壶。首次使用前请仔细阅读本说明书，并妥善保存以备日后查阅。',
  ],
  safetyTitle: ['Safety instructions', '安全须知'],
  safety: [
    [
      'Only connect the kettle to an earthed socket that matches the rated voltage.',
      '仅可将水壶连接到与额定电压相符的接地插座。',
    ],
    ['Do not immerse the kettle, power base or cord in water.', '请勿将水壶、电源底座或电源线浸入水中。'],
    ['Never operate the kettle when the water level is below MIN or above MAX.', '水位低于 MIN 或高于 MAX 时，切勿使用水壶。'],
    ['Keep the appliance out of reach of children under 8 years.', '请将本产品放在 8 岁以下儿童接触不到的地方。'],
  ],
  warnTitle: ['WARNING', '警告'],
  warn: [
    'Hot surfaces and steam can cause burns. Do not open the lid while the water is boiling.',
    '高温表面和蒸汽可能造成烫伤。水沸腾时请勿打开壶盖。',
  ],
  figTitle: ['Product overview', '产品概览'],
  figCaption: ['Figure 1. Main parts of the kettle', '图 1　水壶主要部件'],
  labels: [
    ['Lid button', '开盖按钮'],
    ['Water level window', '水位窗'],
    ['Temperature dial', '温度旋钮'],
    ['Power base', '电源底座'],
  ],
  startTitle: ['Getting started', '快速上手'],
  steps: [
    ['Fill the kettle with fresh water between the MIN and MAX marks.', '在 MIN 与 MAX 刻度之间加入清水。'],
    ['Place the kettle on the power base and plug in the cord.', '将水壶放在电源底座上，并插上电源线。'],
    ['Turn the temperature dial to the desired setting: 70, 85 or 100 °C.', '将温度旋钮转到所需档位：70、85 或 100 °C。'],
    ['Press the switch. The indicator lights up and turns off when the water is ready.', '按下开关。指示灯亮起，水温达到后自动熄灭。'],
  ],
  specTitle: ['Technical specifications', '技术参数'],
  specs: [
    [['Rated voltage', '额定电压'], '220–240 V ~ 50/60 Hz'],
    [['Rated power', '额定功率'], '1800 W'],
    [['Capacity', '容量'], '1.7 L'],
    [['Net weight', '净重'], '1.2 kg'],
  ],
  careTitle: ['Cleaning and care', '清洁与保养'],
  care: [
    'Unplug the kettle and let it cool down before cleaning. Wipe the outside with a damp cloth. To remove limescale, boil a mixture of water and white vinegar, then rinse twice with clean water.',
    '清洁前请拔下电源并待水壶冷却。用湿布擦拭外壳。如需除水垢，可将清水与白醋混合煮沸，然后用清水冲洗两遍。',
  ],
  tip: ['Tip: descale every four weeks in hard-water areas.', '提示：在硬水地区，请每四周除垢一次。'],
  footer1: ['AquaBrew SK-200 · Page 1', 'AquaBrew SK-200 · 第 1 页'],
  footer2: ['AquaBrew SK-200 · Page 2', 'AquaBrew SK-200 · 第 2 页'],
};

const W = 595.28;
const H = 841.89;
const M = 56;

function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws wrapped text with its top at `top` (from page top); returns the new top. */
function para(page, text, { font, size, x = M, top, width = W - 2 * M, color = rgb(0.13, 0.13, 0.15), leading = 1.4 }) {
  const lines = wrapText(text, font, size, width);
  lines.forEach((line, i) => {
    page.drawText(line, { x, y: H - top - size * 0.8 - i * size * leading, size, font, color });
  });
  return top + lines.length * size * leading;
}

async function bannerPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1190" height="260">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0f766e"/><stop offset="0.6" stop-color="#155e75"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs>
    <rect width="1190" height="260" fill="url(#g)"/>
    <circle cx="1040" cy="40" r="160" fill="#ffffff" fill-opacity="0.07"/>
    <circle cx="930" cy="250" r="110" fill="#ffffff" fill-opacity="0.06"/>
    <path d="M0 210 C 300 170, 600 250, 1190 190 L1190 260 L0 260 Z" fill="#ffffff" fill-opacity="0.08"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function figurePng() {
  const [lid, level, dial, base] = T.labels.map((l) => l[0]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="560">
    <rect width="960" height="560" fill="#f3f6f8"/>
    <g stroke="#334155" stroke-width="6" fill="#ffffff">
      <path d="M330 150 L630 150 L660 430 L300 430 Z"/>
      <rect x="360" y="120" width="240" height="40" rx="14"/>
      <path d="M630 200 C 730 200, 740 380, 650 390" fill="none"/>
      <path d="M330 190 L250 150" fill="none"/>
      <rect x="270" y="430" width="420" height="60" rx="16" fill="#e2e8f0"/>
    </g>
    <rect x="400" y="200" width="36" height="190" rx="10" fill="#bae6fd" stroke="#334155" stroke-width="4"/>
    <circle cx="560" cy="460" r="20" fill="#f97316" stroke="#334155" stroke-width="4"/>
    <circle cx="480" cy="128" r="12" fill="#0f766e"/>
    <g stroke="#64748b" stroke-width="3">
      <line x1="480" y1="116" x2="480" y2="60"/><line x1="436" y1="300" x2="160" y2="300"/>
      <line x1="580" y1="460" x2="760" y2="460"/><line x1="290" y1="470" x2="150" y2="520"/>
    </g>
    <g font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#0f172a">
      <text x="480" y="46" text-anchor="middle">${lid}</text>
      <text x="40" y="290">${level.split(' ').slice(0, 2).join(' ')}</text>
      <text x="40" y="326">${level.split(' ').slice(2).join(' ')}</text>
      <text x="772" y="452">${dial.split(' ')[0]}</text>
      <text x="772" y="488">${dial.split(' ')[1]}</text>
      <text x="30" y="545">${base}</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.13, 0.16);
  const teal = rgb(0.06, 0.46, 0.43);
  const muted = rgb(0.4, 0.42, 0.46);

  // ---------- Page 1 ----------
  const p1 = pdf.addPage([W, H]);
  const banner = await pdf.embedPng(await bannerPng());
  p1.drawImage(banner, { x: 0, y: H - 130, width: W, height: 130 });
  p1.drawText(T.brand[0], { x: M, y: H - 42, size: 11, font: bold, color: rgb(0.8, 0.95, 0.93) });
  p1.drawText(T.title[0], { x: M, y: H - 80, size: 26, font: bold, color: rgb(1, 1, 1) });
  p1.drawText(T.subtitle[0], { x: M, y: H - 104, size: 14, font: reg, color: rgb(0.88, 0.96, 0.98) });

  let top = 160;
  top = para(p1, T.intro[0], { font: reg, size: 10.5, top }) + 18;
  p1.drawText(T.safetyTitle[0], { x: M, y: H - top - 11, size: 14, font: bold, color: teal });
  top += 26;
  for (const [en] of T.safety) {
    p1.drawCircle({ x: M + 4, y: H - top - 6, size: 2.2, color: ink });
    top = para(p1, en, { font: reg, size: 10.5, x: M + 16, width: W - 2 * M - 16, top }) + 5;
  }
  top += 10;
  const boxH = 62;
  p1.drawRectangle({ x: M, y: H - top - boxH, width: W - 2 * M, height: boxH, color: rgb(1, 0.95, 0.88), borderColor: rgb(0.92, 0.55, 0.15), borderWidth: 1.2 });
  p1.drawRectangle({ x: M, y: H - top - boxH, width: 5, height: boxH, color: rgb(0.92, 0.45, 0.1) });
  p1.drawText(T.warnTitle[0], { x: M + 18, y: H - top - 22, size: 11, font: bold, color: rgb(0.7, 0.3, 0.02) });
  para(p1, T.warn[0], { font: reg, size: 10, x: M + 18, width: W - 2 * M - 36, top: top + 30, color: rgb(0.35, 0.2, 0.05) });
  top += boxH + 24;

  p1.drawText(T.figTitle[0], { x: M, y: H - top - 11, size: 14, font: bold, color: teal });
  top += 24;
  const fig = await pdf.embedPng(await figurePng());
  const figW = W - 2 * M;
  const figH = (figW * 560) / 960;
  p1.drawImage(fig, { x: M, y: H - top - figH, width: figW, height: figH });
  top += figH + 8;
  const capW = reg.widthOfTextAtSize(T.figCaption[0], 9);
  p1.drawText(T.figCaption[0], { x: (W - capW) / 2, y: H - top - 9, size: 9, font: reg, color: muted });
  const f1 = reg.widthOfTextAtSize(T.footer1[0], 8.5);
  p1.drawText(T.footer1[0], { x: (W - f1) / 2, y: 30, size: 8.5, font: reg, color: muted });

  // ---------- Page 2 ----------
  const p2 = pdf.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: teal });
  top = 52;
  p2.drawText(T.startTitle[0], { x: M, y: H - top - 14, size: 18, font: bold, color: ink });
  top += 36;
  T.steps.forEach(([en], i) => {
    p2.drawCircle({ x: M + 9, y: H - top - 8, size: 9, color: teal });
    p2.drawText(String(i + 1), { x: M + 6, y: H - top - 11.5, size: 10, font: bold, color: rgb(1, 1, 1) });
    top = para(p2, en, { font: reg, size: 10.5, x: M + 28, width: W - 2 * M - 28, top: top + 2 }) + 12;
  });

  top += 10;
  p2.drawText(T.specTitle[0], { x: M, y: H - top - 14, size: 18, font: bold, color: ink });
  top += 34;
  const rowH = 26;
  T.specs.forEach(([[label], value], i) => {
    const y = H - top - rowH * (i + 1);
    if (i % 2 === 0) p2.drawRectangle({ x: M, y, width: W - 2 * M, height: rowH, color: rgb(0.94, 0.97, 0.96) });
    p2.drawText(label, { x: M + 12, y: y + 9, size: 10.5, font: bold, color: ink });
    p2.drawText(value, { x: M + 220, y: y + 9, size: 10.5, font: reg, color: ink });
  });
  p2.drawRectangle({ x: M, y: H - top - rowH * T.specs.length, width: W - 2 * M, height: rowH * T.specs.length, borderColor: rgb(0.75, 0.82, 0.8), borderWidth: 0.8 });
  top += rowH * T.specs.length + 30;

  p2.drawText(T.careTitle[0], { x: M, y: H - top - 14, size: 18, font: bold, color: ink });
  top += 34;
  top = para(p2, T.care[0], { font: reg, size: 10.5, top }) + 14;
  p2.drawRectangle({ x: M, y: H - top - 34, width: W - 2 * M, height: 34, color: rgb(0.06, 0.46, 0.43) });
  p2.drawText(T.tip[0], { x: M + 14, y: H - top - 21, size: 10.5, font: bold, color: rgb(1, 1, 1) });
  const f2 = reg.widthOfTextAtSize(T.footer2[0], 8.5);
  p2.drawText(T.footer2[0], { x: (W - f2) / 2, y: 30, size: 8.5, font: reg, color: muted });

  pdf.setTitle('AquaBrew SK-200 User Manual (sample)');
  await mkdir('public/sample', { recursive: true });
  await writeFile('public/sample/aquabrew-sk200-manual.pdf', await pdf.save());

  // Demo dictionary: normalised English → Simplified Chinese.
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const dict = {};
  const add = ([en, zh]) => (dict[norm(en)] = zh);
  [T.brand, T.title, T.subtitle, T.intro, T.safetyTitle, T.warnTitle, T.warn, T.figTitle, T.figCaption, T.startTitle, T.specTitle, T.careTitle, T.care, T.tip, T.footer1, T.footer2].forEach(add);
  T.safety.forEach(add);
  T.steps.forEach(add);
  T.labels.forEach(add);
  T.specs.forEach(([l]) => add(l));
  // Title block lines may be grouped together by layout analysis.
  add([`${T.title[0]} ${T.subtitle[0]}`, `${T.title[1]}\n${T.subtitle[1]}`]);
  add([T.safety.map((s) => s[0]).join(' '), T.safety.map((s) => s[1]).join('\n')]);
  await writeFile('src/lib/sample-dict.json', JSON.stringify(dict, null, 2) + '\n');
  console.log('wrote public/sample/aquabrew-sk200-manual.pdf and src/lib/sample-dict.json');
}

main();
