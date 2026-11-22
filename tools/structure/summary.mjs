import { limits } from '../../eslint.config.mjs';

export function printSummary(counts, sizes, seconds) {
  console.log(
    `上限: ファイル${limits.file}行・関数${limits.function}行（空行・コメントを除く）。書き写し: 既定の50トークン・5行。`,
  );
  for (const kind of ['files', 'functions']) {
    const bins = [0, 100, 200, 400, 800, 1600];
    const distribution = bins.map((min, index) => {
      const max = bins[index + 1] ?? Infinity;
      const count = sizes[kind].filter(({ lines }) => lines >= min && lines < max).length;
      return `${min}〜${max === Infinity ? '' : max - 1}行: ${count}`;
    });
    console.log(`${kind}の分布（${sizes[kind].length}件）: ${distribution.join('、')}`);
    console.log(
      `  上位5件: ${[...sizes[kind]]
        .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file, 'en'))
        .slice(0, 5)
        .map(({ file, line, lines }) => `${file}:${line}=${lines}`)
        .join('、')}`,
    );
  }
  for (const category of Object.keys(counts).sort()) {
    const ranked = Object.entries(counts[category]).sort(
      ([a, x], [b, y]) => y - x || a.localeCompare(b, 'en'),
    );
    console.log(
      `${category}: 合計${ranked.reduce((sum, [, n]) => sum + n, 0)}、上位5ファイル: ${
        ranked
          .slice(0, 5)
          .map(([file, n]) => `${file}=${n}`)
          .join('、') || 'なし'
      }`,
    );
  }
  console.log(`コードのつくりの検査: ${seconds.toFixed(2)}秒`);
}
