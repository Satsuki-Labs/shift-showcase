import ts from 'typescript';
import { location } from './files.mjs';

// 構文だけで持ち主を判定できる物。
// 小窓の中身・読み込みの失敗の意味など、判断が要る責任はここで推定しない。
const owners = {
  limits: ['shared/limits.ts'],
  body: ['server/src/entrance/body.ts'],
  date: ['shared/date.ts'],
  leave: ['shared/leave.ts'],
  staff: ['shared/staff.ts'],
  work: [
    'server/src/saves/work-day.ts',
    'server/src/saves/periods.ts',
    'server/src/saves/receiver.ts',
  ],
  viewport: ['frontend/src/parts/viewport.ts'],
  floating: ['frontend/src/parts/Floating.tsx'],
  dismiss: ['frontend/src/parts/useDismissOutside.ts', 'frontend/src/parts/Dialog.tsx'],
};
const limitNames = new Set([
  'MAX_ID_LENGTH',
  'MAX_STAFF_NAME_LENGTH',
  'MAX_STAFF_NOTES_LENGTH',
  'MAX_PERIOD_DAYS',
  'MAX_COVERAGE_REQUIRED',
  'MAX_QUARTER_HOUR_PAY',
  'MAX_PERIOD_BUDGET',
  'MIN_FISCAL_YEAR',
  'MAX_FISCAL_YEAR',
  'MAX_INPUT_BYTES',
  'MAX_JSON_DEPTH',
]);
const ownerFunctions = {
  date: ['isValidDate', 'addDays', 'dateRange', 'japanDate', 'japanDateTime'],
  leave: ['circledNumber', 'holidayLabels', 'paidLeaveLabels'],
  staff: [
    'splitStaffName',
    'joinStaffName',
    'staffFamilyName',
    'requestedWorkAssignment',
    'workSlotsOverlap',
    'japanToday',
  ],
  viewport: ['layoutValue', 'layoutBounds', 'displayValues', 'layoutScrollTo', 'layoutScrollTop'],
  floating: ['useFloating', 'floatingHost'],
  dismiss: ['useDismissOutside'],
};

function checkNode(node, entry, handlers, report) {
  const { source, path } = entry;
  const use = (owner, message) => {
    if (!owners[owner].includes(path))
      report(
        `ownership/${owner}`,
        path,
        location(source, node),
        `${message}：${owners[owner].join('、')} を使う`,
      );
  };
  const production = /^(?:frontend\/src|server\/src|shared)\//.test(path);
  if (!production) return;
  if (
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    for (const [owner, names] of Object.entries(ownerFunctions))
      if (names.includes(node.name.text)) use(owner, node.name.text);
    if (limitNames.has(node.name.text) && node.initializer) use('limits', node.name.text);
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
    const text = ts.isTemplateExpression(node)
      ? node.head.text + node.templateSpans.map((span) => span.literal.text).join('')
      : node.text;
    if (
      /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`\[]?(?:day_states|work_slots)\b/i.test(
        text,
      )
    )
      use('work', '勤務の表への書き込み');
  }
  if (ts.isNumericLiteral(node) && [0x2460, 0x3251, 0x32b1].includes(Number(node.text)))
    use('leave', '丸数字の組み立て');
  if (ts.isCallExpression(node)) {
    const call = node.expression;
    const text = call.getText(source);
    if (/^(?:vi|jest)\.(?:mock|doMock|spyOn|stubGlobal)$/.test(text))
      report(
        'ownership/test-double',
        path,
        location(source, node),
        '試験のための差し替えは試験の中だけに置く',
      );
    if (ts.isPropertyAccessExpression(call)) {
      if (/^(?:setDate|setUTCDate)$/.test(call.name.text)) use('date', '日付を足す処理');
      if (
        path.startsWith('server/src/') &&
        /^(?:json|text|arrayBuffer|formData)$/.test(call.name.text) &&
        /^(?:request|req)$/.test(call.expression.getText(source))
      )
        use('body', '要求本文の読み取り');
      const event = node.arguments[0];
      const callback = node.arguments[1];
      const handlersText =
        callback &&
        (ts.isIdentifier(callback)
          ? (handlers.get(callback.text) ?? []).join('\n')
          : callback.getText(source));
      if (
        text === 'document.addEventListener' &&
        event &&
        ts.isStringLiteralLike(event) &&
        (['pointerdown', 'click'].includes(event.text) ||
          (event.text === 'keydown' && /["']Escape["']/.test(handlersText ?? ''))) &&
        !path.startsWith('frontend/src/request/')
      )
        use('dismiss', '外を押す・Escの共通の監視');
      if (
        call.name.text === 'setProperty' &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text === '--management-scale'
      )
        use('viewport', '管理画面の倍率の設定');
    }
  }
  // 名前のコピーだけでなく、日本時間と氏名の代表的な再実装も見張る。
  if (
    ts.isBinaryExpression(node) &&
    /^(?:9\s*\*\s*60\s*\*\s*60\s*\*\s*1000|(?:9\s*\*\s*60|540)\s*\*\s*60_?000|32_?400_?000)$/.test(
      node.getText(source),
    )
  )
    use('date', '日本時間の時差の計算');
  if (
    ts.isRegularExpressionLiteral(node) &&
    /(?:\\u3000|　)/.test(node.text) &&
    node.parent &&
    ts.isCallExpression(node.parent) &&
    /\.(?:split|search)$/.test(node.parent.expression.getText(source))
  )
    use('staff', '氏名の名字・名前への分割');
}

export function checkOwnership(entries, report) {
  const calendar = entries.find(({ path }) => path === 'shared/calendar.ts');
  const declaration = calendar?.source.statements
    .flatMap((node) => (ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []))
    .find((node) => ts.isIdentifier(node.name) && node.name.text === 'facilities');
  let array = declaration?.initializer;
  while (
    array &&
    (ts.isAsExpression(array) ||
      ts.isSatisfiesExpression(array) ||
      ts.isParenthesizedExpression(array))
  )
    array = array.expression;
  if (
    !array ||
    !ts.isArrayLiteralExpression(array) ||
    array.elements.length !== 4 ||
    !array.elements.every(
      (node, index) =>
        ts.isStringLiteralLike(node) && node.text === String.fromCharCode(65 + index),
    )
  )
    report(
      'ownership/facilities-order',
      'shared/calendar.ts',
      declaration ? location(calendar.source, declaration) : 1,
      '共通の施設一覧はA、B、C、Dの順に並ぶ',
    );
  for (const entry of entries) {
    if (!entry.source) continue;
    const handlers = new Map();
    const collect = (node) => {
      if (
        (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        const value = ts.isVariableDeclaration(node) ? node.initializer : node;
        if (value)
          handlers.set(node.name.text, [
            ...(handlers.get(node.name.text) ?? []),
            value.getText(entry.source),
          ]);
      }
      ts.forEachChild(node, collect);
    };
    collect(entry.source);
    const visit = (node) => {
      const facilityList =
        ts.isArrayLiteralExpression(node) &&
        node.elements.length === 4 &&
        node.elements.every(
          (element, index) =>
            ts.isStringLiteralLike(element) && element.text === String.fromCharCode(65 + index),
        );
      if (
        entry.path !== 'shared/calendar.ts' &&
        /^(?:frontend\/src|server\/src|shared|tools)\//.test(entry.path) &&
        (facilityList || (ts.isStringLiteralLike(node) && /^ABCD$/.test(node.text)))
      )
        report(
          'ownership/facilities',
          entry.path,
          location(entry.source, node),
          'shared/calendar.ts の facilities を使う',
        );
      checkNode(node, entry, handlers, report);
      ts.forEachChild(node, visit);
    };
    visit(entry.source);
  }
}
