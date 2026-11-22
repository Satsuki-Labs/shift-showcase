import postcss from 'postcss';
import { checkCss } from './style-css.mjs';
import { checkInline } from './style-inline.mjs';
import { checkArrival } from './style-arrival.mjs';

export function checkStyles(entries, report) {
  const classFiles = new Map();
  const keyframes = [];
  // 旧検査のSetと同じく、同じ宣言を複数の条件が見つけても1件にする。
  const seen = new Set();
  const emit = (...finding) => {
    const key = JSON.stringify(finding);
    if (!seen.has(key)) {
      seen.add(key);
      report(...finding);
    }
  };
  for (const entry of entries.filter(({ path }) => path.startsWith('frontend/src/'))) {
    if (!entry.file.endsWith('.css')) {
      checkInline(entry, emit);
      continue;
    }
    checkCss(entry, classFiles, emit);
    const css = postcss.parse(entry.text, { from: entry.file });
    if (entry.path !== 'frontend/src/styles/tokens.css')
      css.walkDecls((declaration) => {
        if (/\bblur\(\s*[+-]?(?:\d|\.\d)/i.test(declaration.value))
          emit(
            'styles/blur',
            entry.path,
            declaration.source.start.line,
            `${declaration.prop}: ${declaration.value}`,
          );
      });
    css.walkAtRules(/^(?:-webkit-)?keyframes$/, (rule) => {
      keyframes.push({ file: entry.path, rule });
    });
  }
  checkArrival(keyframes, emit);
  for (const [name, files] of classFiles) {
    if (files.size > 1)
      for (const [file, line] of files)
        emit(
          'styles/class-owner',
          file,
          line,
          `.${name} の基本の指定が複数のファイルにあります: ${[...files.keys()].sort().join(', ')}`,
        );
  }
}
