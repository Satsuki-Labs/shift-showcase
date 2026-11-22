export function checkArrival(keyframes, report) {
  const frames = (rule) =>
    JSON.stringify(
      (rule.nodes ?? [])
        .filter((node) => node.type !== 'comment')
        .map((node) =>
          node.type === 'rule'
            ? [
                node.selector.replace(/\bfrom\b/g, '0%').replace(/\bto\b/g, '100%'),
                node.nodes
                  .filter((declaration) => declaration.type !== 'comment')
                  .map((declaration) =>
                    declaration.type === 'decl'
                      ? `${declaration.prop}:${declaration.prop === 'filter' && /^blur\(/i.test(declaration.value) ? 'blur' : declaration.value.replace(/\s+/g, '')}`
                      : declaration.toString(),
                  )
                  .sort(),
              ]
            : node.toString(),
        )
        .sort(),
    );
  const owner = keyframes.find(
    ({ file, rule }) =>
      file === 'frontend/src/parts/Reveal.css' && rule.params === 'period-arrival',
  );
  if (!owner) {
    report(
      'styles/arrival-owner',
      'frontend/src/parts/Reveal.css',
      1,
      'にじみの持ち主 period-arrival がない',
    );
    return;
  }
  for (const entry of keyframes) {
    if (entry !== owner && frames(entry.rule) === frames(owner.rule)) {
      report(
        'styles/arrival-copy',
        entry.file,
        entry.rule.source.start.line,
        `@${entry.rule.name} ${entry.rule.params}: period-arrival を使う`,
      );
    }
  }
}
