/**
 * Why Recto exists: the internship that prompted it, and how each problem met
 * there became a design rule.
 */

const PAIRS: [string, string][] = [
  ['每种语言导出来的格式都不一样', '统一按原页面尺寸导出 PDF 和 PNG，每个语言版本的版式都和原文一致'],
  ['插图里的字换不掉，图一变就得重新处理', '图片里的文字也会识别、擦除，再按原来的字号和颜色排回去'],
  ['译文长短不一，排好的版面一放就乱', '每一段都回到原来的位置，放不下就自动缩小字号，并标出来让人检查'],
];

export function Origin() {
  return (
    <section className="origin" id="origin">
      <div className="origin-copy">
        <p className="hand-label">why recto</p>
        <h2 className="ink-title">从一次暑期实习开始</h2>
        <p className="reveal">
          暑期实习时，我接到一个任务：把一份只有单一语言的说明书，翻译成多种语言的版本。
        </p>
        <p className="reveal">
          真正花时间的不是翻译，而是翻译之后：每种语言都要重新排一遍版，导出来的格式各不相同；说明书里的插图带着文字，换了语言，图上的字却还是原文。
        </p>
        <p className="reveal origin-pull">Recto 想解决的就是这一步：让译文自己回到原来的位置。</p>
      </div>
      <ol className="origin-map">
        <li className="origin-map-head reveal" aria-hidden>
          <span>当时遇到的问题</span>
          <span>现在的做法</span>
        </li>
        {PAIRS.map(([problem, answer], i) => (
          <li key={problem} className="origin-row reveal">
            <span className="origin-no">0{i + 1}</span>
            <p className="origin-problem">{problem}</p>
            <svg className="origin-arrow" viewBox="0 0 60 20" aria-hidden>
              <path className="draw-on-view" d="M2 12 C 18 4, 36 16, 54 9 M46 4 L55 9 L47 15" />
            </svg>
            <p className="origin-answer">{answer}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
