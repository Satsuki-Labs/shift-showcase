export const exceptions = [
  {
    file: 'frontend/src/styles/tokens.css',
    property: 'font-weight',
    value: '500',
    context: '@font-face',
    reason: 'フォントファイルのウェイト記述子にはカスタムプロパティを使えない。',
  },
  {
    file: 'frontend/src/styles/tokens.css',
    property: 'font-weight',
    value: '700',
    context: '@font-face',
    reason: 'フォントファイルのウェイト記述子にはカスタムプロパティを使えない。',
  },
  {
    file: 'frontend/src/styles/tokens.css',
    property: 'font-weight',
    value: '900',
    context: '@font-face',
    reason: 'フォントファイルのウェイト記述子にはカスタムプロパティを使えない。',
  },
  {
    file: 'frontend/src/styles/base.css',
    property: 'line-height',
    value: 'round(nearest, calc(var(--leading) * 1em), 2px)',
    context: '@layer base > *',
    reason: '字の大きさと倍率から2pxの倍数へ丸める土台。',
  },
];
export const classExceptions = [
  {
    name: 'dlg',
    file: 'frontend/src/frame/frame.css',
    selectors: ['.dlg.update-notice'],
    reason: '画面固有の小窓の幅。部品名と画面名を同じ要素に付けた既存の指定を保つ。',
  },
  {
    name: 'dlg',
    file: 'frontend/src/shift/shift.css',
    selectors: ['.dlg.cell-dialog', '.dlg.bulk'],
    reason: '画面固有の小窓の幅。部品名と画面名を同じ要素に付けた既存の指定を保つ。',
  },
  {
    name: 'dlg',
    file: 'frontend/src/periods/periods.css',
    selectors: ['.dlg.url-dialog'],
    reason: '画面固有の小窓の幅。部品名と画面名を同じ要素に付けた既存の指定を保つ。',
  },
  {
    name: 'dim',
    file: 'frontend/src/shift/shift.css',
    selectors: ['.dim:has(> .bulk)'],
    reason: '一括入力の小窓だけの余白。既存のセレクターを保つ。',
  },
  {
    name: 'lab',
    file: 'frontend/src/yearly/yearly.css',
    selectors: ['.lab.day-heading'],
    reason: '日の行事・メモの見出し。共通ラベルに画面の名前を併用した既存の指定を保つ。',
  },
  {
    name: 'dlg',
    file: 'frontend/src/parts/Reveal.css',
    selectors: ['.dlg.animate-height'],
    reason: '出入りと小窓の高さの動きに共通の変数。既存の規則を分解せずRevealに集める。',
  },
];
const colorNames = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  ),
);
// PostCSSの宣言値を、引用した文字列・関数・単語に分ける。urlの中の#や、文字列は色として扱わない。
export function values(input) {
  let index = 0;
  const read = () => {
    const result = [];
    while (index < input.length && input[index] !== ')') {
      if (/\s/.test(input[index])) {
        index++;
        continue;
      }
      const start = index;
      if (input[index] === '"' || input[index] === "'") {
        const quote = input[index++];
        while (index < input.length) {
          if (input[index++] === '\\') index++;
          else if (input[index - 1] === quote) break;
        }
        result.push({ text: input.slice(start, index), quoted: true });
        continue;
      }
      const word = /^(?:#[\da-f]+\b|(?:[\w.%#-]|\\(?:[\da-f]{1,6}\s?|.))+)/i.exec(
        input.slice(index),
      );
      if (!word) {
        result.push({ text: input[index++] });
        continue;
      }
      index += word[0].length;
      const name = word[0]
        .replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, char) =>
          hex ? String.fromCodePoint(parseInt(hex, 16)) : char,
        )
        .toLowerCase();
      if (input[index] === '(') {
        index++;
        const children = read();
        if (input[index] === ')') index++;
        result.push({ text: input.slice(start, index), name, children });
      } else result.push({ text: name });
    }
    return result;
  };
  return read();
}
export function colors(nodes) {
  return nodes.flatMap((node) => {
    if (node.quoted || node.name === 'url') return [];
    if (
      /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/.test(node.name ?? '') ||
      /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(node.text) ||
      colorNames.has(node.text)
    )
      return [node.text];
    return node.children ? colors(node.children) : [];
  });
}
export const variable = (value) => /^var\(\s*--[\w-]+\s*\)$/.test(value);
export const relativeSize = (value) =>
  /^(?:\d*\.)?\d+(?:em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|%|vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/.test(
    value,
  );
export const size = (node) =>
  variable(node.text) ||
  node.text === 'inherit' ||
  relativeSize(node.text) ||
  (['calc', 'min', 'max', 'clamp'].includes(node.name ?? '') &&
    (node.children ?? []).every((child) => size(child) || /^[\d.+*/,-]+$/.test(child.text)));
export const lineHeight = (value) =>
  /^(revert-layer|inherit)$/.test(value) ||
  (/^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) % 2 === 0);
export const radius = (value) =>
  values(value).every(
    (node) => variable(node.text) || ['0', '50%', 'inherit', '/'].includes(node.text),
  );
export const shadow = (value) => value === 'none' || variable(value);
export function directMotion(nodes) {
  return nodes.some((node) => {
    if (node.quoted || node.name === 'var') return false;
    if (/^[+-]?(?:\d*\.\d+|\d+)(ms|s)$/.test(node.text) && !/^0(?:ms|s)$/.test(node.text))
      return true;
    if (
      /^(ease(?:-in(?:-out)?|-out)?|linear|step-start|step-end)$/.test(node.text) ||
      /^(cubic-bezier|steps|linear)$/.test(node.name ?? '')
    )
      return true;
    return node.children ? directMotion(node.children) : false;
  });
}
