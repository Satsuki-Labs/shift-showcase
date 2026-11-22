import { readFileSync, writeFileSync } from 'node:fs';

export function collect() {
  // 0件の項目も記録する。新しいファイル・項目の基準値は0。
  const counts = Object.fromEntries(
    [
      'size/file-lines',
      'size/function-lines',
      'imports/direction',
      'ownership/facilities',
      'ownership/facilities-order',
      'ownership/limits',
      'ownership/body',
      'ownership/date',
      'ownership/leave',
      'ownership/staff',
      'ownership/work',
      'ownership/viewport',
      'ownership/floating',
      'ownership/dismiss',
      'ownership/test-double',
      'styles/value',
      'styles/blur',
      'styles/arrival-owner',
      'styles/arrival-copy',
      'styles/class-owner',
      'types/any',
      'types/as-unknown-as',
      'types/ts-ignore',
      'types/ts-expect-error',
      'types/eslint-disable',
      'duplicates/blocks',
      'unused/files',
      'unused/exports',
      'unused/types',
      'unused/nsExports',
      'unused/nsTypes',
    ].map((category) => [category, {}]),
  );
  const findings = [];
  const report = (category, file, line, message, count = 1) => {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error(`不正な件数: ${category}`);
    counts[category] ??= {};
    counts[category][file] = (counts[category][file] ?? 0) + count;
    findings.push({ category, file, line, message });
  };
  return { counts, findings, report };
}

export function writeBaseline(file, counts) {
  const sorted = Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((category) => [
        category,
        Object.fromEntries(
          Object.entries(counts[category])
            .filter(([, n]) => n > 0)
            .sort(([a], [b]) => a.localeCompare(b, 'en')),
        ),
      ]),
  );
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}

export function compareBaseline(file, counts, findings, update) {
  // 初回の基準値は実装時に記録する。通常の命令で基準値を作ったり増やしたりしない。
  const baseline = JSON.parse(readFileSync(file, 'utf8'));
  const increases = [];
  let decreased = false;
  for (const category of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
    for (const path of new Set([
      ...Object.keys(baseline[category] ?? {}),
      ...Object.keys(counts[category] ?? {}),
    ])) {
      const previous = baseline[category]?.[path] ?? 0;
      const current = counts[category]?.[path] ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0)
        throw new Error(`不正な基準値: ${category} ${path}`);
      if (current > previous) {
        increases.push(`${category} ${path}: ${previous}→${current}`);
        for (const finding of findings.filter(
          (item) => item.category === category && item.file === path,
        ))
          console.error(`${finding.file}:${finding.line} [${category}] ${finding.message}`);
      } else if (current < previous) {
        decreased = true;
        console.log(`基準値を下げてください：${category}、${path}、${previous}→${current}`);
        if (update) baseline[category][path] = current;
      }
    }
  }
  if (update && decreased) writeBaseline(file, baseline);
  for (const increase of increases) console.error(`基準値より増えています：${increase}`);
  return increases.length === 0;
}
