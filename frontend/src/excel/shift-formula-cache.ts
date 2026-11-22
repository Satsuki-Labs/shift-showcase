import type {
  Cell,
  Sheet,
  XmlNode,
} from 'xlsx-populate/browser/xlsx-populate-no-encryption.min.js';

// xlsx-populate omits cached values when serializing formulas. Attach the values
// at that boundary so normal and shared formula nodes stay exactly as written.
type FormulaCell = Cell & { toXml(): XmlNode };
interface Formula {
  cell: FormulaCell;
  node: XmlNode;
  row: number;
  column: number;
}
const child = (node: XmlNode, name: string) =>
  node.children.find((item): item is XmlNode => typeof item !== 'string' && item.name === name);
const columnNumber = (letters: string) =>
  [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
function columnLetters(column: number): string {
  return column > 0
    ? columnLetters(Math.floor((column - 1) / 26)) + String.fromCharCode(65 + ((column - 1) % 26))
    : '';
}

/** Only the template's surviving cell references and COUNTIF sums are evaluated. */
export function cacheShiftFormulas(sheet: Sheet): void {
  const formulas = new Map<string, Formula>(),
    shared = new Map<string | number, Formula>();
  // This template's used range starts at A1.
  sheet
    .usedRange()
    .value()
    .forEach((row, r) =>
      row.forEach((_, c) => {
        const cell = sheet.cell(r + 1, c + 1) as FormulaCell;
        if (!cell.formula()) return;
        const xml = cell.toXml(),
          node = child(xml, 'f')!;
        const formula = { cell, node, row: r + 1, column: c + 1 };
        formulas.set(String(xml.attributes.r), formula);
        if (node.attributes.t === 'shared' && node.children?.length)
          shared.set(node.attributes.si, formula);
      }),
    );
  const expression = (formula: Formula): string => {
    if (formula.node.children?.length) return formula.node.children.join('');
    const source = shared.get(formula.node.attributes.si)!;
    return source.node.children
      .join('')
      .replace(
        /(\$?)([A-Z]+)(\$?)(\d+)/g,
        (_, absoluteColumn, column, absoluteRow, row) =>
          `${absoluteColumn}${columnLetters(columnNumber(column) + (absoluteColumn ? 0 : formula.column - source.column))}` +
          `${absoluteRow}${Number(row) + (absoluteRow ? 0 : formula.row - source.row)}`,
      );
  };
  const values = new Map<string, string | number>();
  const valueAt = (address: string): string | number => {
    const reference = address.replace(/\$/g, '');
    if (values.has(reference)) return values.get(reference)!;
    const formula = formulas.get(reference);
    if (!formula) return (sheet.cell(reference).value() as string | number | undefined) ?? 0;
    const text = expression(formula);
    let value: string | number;
    if (/^\$?[A-Z]+\$?\d+$/.test(text)) value = valueAt(text);
    else {
      value = 0;
      for (const term of text.split('+')) {
        const count = term.match(
          /^COUNTIF\((\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+),\s*(?:"([^"]*)"|(\$?[A-Z]+\$?\d+))\)$/,
        );
        if (!count) throw new Error(`Unsupported shift template formula: ${text}`);
        const criterion = count[3] ?? valueAt(count[4]);
        const start = count[1].match(/([A-Z]+)\$?(\d+)/)!,
          end = count[2].match(/([A-Z]+)\$?(\d+)/)!;
        for (let row = Number(start[2]); row <= Number(end[2]); row++) {
          for (let column = columnNumber(start[1]); column <= columnNumber(end[1]); column++) {
            const current = valueAt(`${columnLetters(column)}${row}`);
            // Numeric criteria in this template are times, at minute precision.
            if (
              typeof current === 'number' && typeof criterion === 'number'
                ? Math.round(current * 1440) === Math.round(criterion * 1440)
                : current === criterion
            )
              value++;
          }
        }
      }
    }
    values.set(reference, value);
    return value;
  };
  for (const address of formulas.keys()) valueAt(address);
  for (const [address, { cell }] of formulas) {
    const toXml = cell.toXml.bind(cell),
      value = values.get(address)!;
    cell.toXml = () => {
      const node = toXml();
      if (typeof value === 'string') node.attributes.t = 'str';
      node.children.push({ name: 'v', attributes: {}, children: [String(value)] });
      return node;
    };
  }
}
