export interface ConflictField {
  label: string;
  yours: string | readonly string[];
  theirs: string | readonly string[];
  separators?: readonly string[];
  wholeText?: boolean;
}
interface ConflictText {
  text: string;
  changed: boolean;
}
export interface ConflictRow {
  label: string;
  yours: ConflictText[];
  theirs: ConflictText[];
}

/** Match complete values such as times and roles; plain text is compared by character. */
export function conflictRows(fields: readonly ConflictField[]): ConflictRow[] {
  return fields.flatMap((field) => {
    if (field.wholeText) {
      const yours = typeof field.yours === 'string' ? field.yours : field.yours.join('');
      const theirs = typeof field.theirs === 'string' ? field.theirs : field.theirs.join('');
      return yours === theirs
        ? []
        : [
            {
              label: field.label,
              yours: [{ text: yours || 'なし', changed: true }],
              theirs: [{ text: theirs || 'なし', changed: true }],
            },
          ];
    }
    const left =
      typeof field.yours === 'string' ? Array.from(field.yours || 'なし') : [...field.yours];
    const right =
      typeof field.theirs === 'string' ? Array.from(field.theirs || 'なし') : [...field.theirs];
    if (left.join('') === right.join('')) return [];
    const lengths = Array.from(
      { length: left.length + 1 },
      () => new Uint16Array(right.length + 1),
    );
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--) {
        lengths[i][j] =
          left[i] === right[j]
            ? lengths[i + 1][j + 1] + 1
            : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    const yours: ConflictText[] = [],
      theirs: ConflictText[] = [];
    const append = (parts: ConflictText[], text: string, changed: boolean) => {
      if (field.separators?.includes(text)) changed = false;
      const last = parts[parts.length - 1];
      if (last?.changed === changed) last.text += text;
      else parts.push({ text, changed });
    };
    let i = 0,
      j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        append(yours, left[i++], false);
        append(theirs, right[j++], false);
      } else if (i < left.length && (j === right.length || lengths[i + 1][j] >= lengths[i][j + 1]))
        append(yours, left[i++], true);
      else append(theirs, right[j++], true);
    }
    return [{ label: field.label, yours, theirs }];
  });
}
