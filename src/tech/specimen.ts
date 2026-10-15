/**
 * A small synthetic "scanned textbook" page for the technical notes: dialogue
 * lines with furigana, a contents line with leader dots, and a sign inside an
 * illustration. Drawn on a canvas so line detection can run on it live.
 */

const FONT = '"Noto Sans SC", "Yu Gothic", "Microsoft YaHei", sans-serif';

type Part = [text: string, ruby?: string];

const LINES: { y: number; who?: string; parts: Part[] }[] = [
  { y: 260, who: 'A', parts: [['すみません。'], ['受付', 'うけつけ'], ['は　どこですか。']] },
  { y: 330, who: 'B', parts: [['あそこです。']] },
  { y: 400, who: 'A', parts: [['どうも。'], ['会議室', 'かいぎしつ'], ['も　あそこですか。']] },
  { y: 470, who: 'B', parts: [['いいえ、'], ['会議室', 'かいぎしつ'], ['は　'], ['三階', 'さんがい'], ['です。']] },
];

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Loads the glyph subsets the page needs before drawing on canvas. */
export async function specimenFontsReady() {
  const text = LINES.flatMap((l) => l.parts.map((p) => p.join(''))).join('') + '第3課ここはどこですか練習A受付案内';
  await Promise.all([
    document.fonts.load(`bold 34px ${FONT}`, text),
    document.fonts.load(`28px ${FONT}`, text),
    document.fonts.load(`12px ${FONT}`, text),
  ]);
}

function rubyLine(x: CanvasRenderingContext2D, left: number, base: number, parts: Part[]) {
  let cx = left;
  for (const [text, ruby] of parts) {
    x.font = `28px ${FONT}`;
    x.fillText(text, cx, base);
    const w = x.measureText(text).width;
    if (ruby) {
      x.font = `12px ${FONT}`;
      const rw = x.measureText(ruby).width;
      x.fillText(ruby, cx + (w - rw) / 2, base - 30);
    }
    cx += w;
  }
}

export function drawSpecimen(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1240;
  c.height = 860;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2efe8';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#161616';
  x.textBaseline = 'alphabetic';

  // Lesson title with ruby on the counter.
  x.font = `bold 34px ${FONT}`;
  x.fillText('第3課　ここは　どこですか', 90, 140);
  x.font = `12px ${FONT}`;
  x.fillText('だい　 か', 92, 104);

  for (const line of LINES) {
    x.font = `bold 28px ${FONT}`;
    x.fillText(`${line.who}：`, 90, line.y);
    rubyLine(x, 150, line.y, line.parts);
  }

  // Contents line with leader dots.
  x.font = `24px ${FONT}`;
  x.fillText('練習A', 90, 590);
  for (let i = 0; i < 22; i++) x.fillRect(190 + i * 16, 584, 4, 4);
  x.fillText('24', 560, 590);

  // Illustration: a reception desk with a hanging sign, and a visitor.
  x.strokeStyle = '#161616';
  x.lineWidth = 3;
  x.lineCap = 'round';
  x.strokeRect(780, 520, 330, 150);
  x.beginPath();
  x.moveTo(800, 520);
  x.lineTo(800, 470);
  x.moveTo(1090, 520);
  x.lineTo(1090, 470);
  x.stroke();
  x.strokeRect(860, 380, 170, 70);
  x.beginPath();
  x.moveTo(900, 380);
  x.lineTo(900, 330);
  x.moveTo(990, 380);
  x.lineTo(990, 330);
  x.stroke();
  x.font = `bold 34px ${FONT}`;
  x.fillText('受付', 911, 428);
  x.beginPath();
  x.arc(690, 540, 36, 0, Math.PI * 2);
  x.moveTo(690, 576);
  x.lineTo(690, 700);
  x.moveTo(640, 620);
  x.lineTo(740, 610);
  x.moveTo(690, 700);
  x.lineTo(660, 780);
  x.moveTo(690, 700);
  x.lineTo(722, 780);
  x.stroke();
  x.beginPath();
  x.arc(678, 532, 4, 0, Math.PI * 2);
  x.arc(704, 532, 4, 0, Math.PI * 2);
  x.fill();

  // Scanner noise.
  const rnd = seeded(7);
  const id = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    id.data[i] += n;
    id.data[i + 1] += n;
    id.data[i + 2] += n;
  }
  x.putImageData(id, 0, 0);
  return c;
}
