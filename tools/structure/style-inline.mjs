import ts from 'typescript';
import { values, colors, size, variable, radius, shadow } from './style-values.mjs';
const colorProperties =
  /^(?:fill|stroke|stopColor|color|background(?:Color|Image)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?|textDecorationColor|caretColor|accentColor|columnRuleColor)$/;
const watched = (property) =>
  colorProperties.test(property) ||
  /^(font|fontSize|fontWeight|border(?:TopLeft|TopRight|BottomLeft|BottomRight)?Radius|boxShadow|textShadow|filter)$/.test(
    property,
  ) ||
  property.startsWith('--');

const name = (node) =>
  ts.isIdentifier(node) || ts.isStringLiteralLike(node)
    ? node.text
    : ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)
      ? node.expression.text
      : undefined;

function createResolver(source) {
  const variables = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      variables.set(node.name.text, [...(variables.get(node.name.text) ?? []), node.initializer]);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const resolveValue = (node, use, seen = new Set()) => {
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const next = new Set(seen).add(node.text);
      for (const initializer of variables.get(node.text) ?? [])
        resolveValue(initializer, use, next);
    } else if (ts.isConditionalExpression(node)) {
      resolveValue(node.whenTrue, use, seen);
      resolveValue(node.whenFalse, use, seen);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      resolveValue(
        node.expression,
        (object) => {
          if (ts.isObjectLiteralExpression(object))
            for (const member of object.properties) {
              if (ts.isPropertyAssignment(member) && name(member.name) === property)
                resolveValue(member.initializer, use, seen);
            }
        },
        seen,
      );
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      resolveValue(node.expression, use, seen);
    else use(node);
  };
  return resolveValue;
}

export function checkInline({ path, source }, emit) {
  const report = (file, line, property, value) =>
    emit('styles/value', file, line, `${property}: ${value}`);
  const resolveValue = createResolver(source);
  const checkValue = (property, expression) =>
    resolveValue(expression, (node) => {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isNumericLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        const value = ts.isTemplateExpression(node)
          ? node.head.text + node.templateSpans.map((span) => span.literal.text).join('')
          : node.text;
        const parsed = values(value);
        const forbidden =
          colors(parsed).length > 0 ||
          (property === 'fontSize' && !parsed.every(size)) ||
          (property === 'fontWeight' && !variable(value) && value !== 'inherit') ||
          (property.endsWith('Radius') && !radius(value)) ||
          (/^(boxShadow|textShadow)$/.test(property) && !shadow(value)) ||
          (property === 'filter' &&
            parsed.some(
              (part) =>
                part.name === 'drop-shadow' &&
                !shadow(part.text.slice(part.text.indexOf('(') + 1, -1).trim()),
            )) ||
          (property === 'font' && !variable(value) && value !== 'inherit');
        if (forbidden)
          report(
            path,
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            property,
            value,
          );
        if (ts.isTemplateExpression(node))
          for (const span of node.templateSpans) checkValue(property, span.expression);
      } else ts.forEachChild(node, (child) => checkValue(property, child));
    });
  const checkStyle = (expression) =>
    resolveValue(expression, (node) => {
      if (ts.isObjectLiteralExpression(node))
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) checkStyle(property.expression);
          else if (ts.isPropertyAssignment(property)) {
            const key = name(property.name);
            if (key && watched(key)) checkValue(key, property.initializer);
          } else if (ts.isShorthandPropertyAssignment(property) && watched(property.name.text))
            checkValue(property.name.text, property.name);
        }
      else ts.forEachChild(node, checkStyle);
    });
  const visit = (node) => {
    if (
      path !== 'frontend/src/parts/motion.ts' &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'getPropertyValue' &&
      node.arguments[0]
    ) {
      resolveValue(node.arguments[0], (argument) => {
        if (
          ts.isStringLiteralLike(argument) &&
          /-duration|-easing|^--motion-|^--ease-/.test(argument.text)
        ) {
          report(
            path,
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            'getPropertyValue',
            argument.text,
          );
        }
      });
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isIdentifier(node.name)) {
      const expression = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (expression) {
        if (node.name.text === 'style') checkStyle(expression);
        else if (/^(fill|stroke|stopColor|color|fontSize|fontWeight)$/.test(node.name.text))
          checkValue(node.name.text, expression);
      }
    } else if (ts.isJsxSpreadAttribute(node))
      resolveValue(node.expression, (props) => {
        if (ts.isObjectLiteralExpression(props))
          for (const property of props.properties) {
            if (ts.isPropertyAssignment(property)) {
              const key = name(property.name);
              if (key === 'style') checkStyle(property.initializer);
              else if (key && /^(fill|stroke|stopColor|color|fontSize|fontWeight)$/.test(key))
                checkValue(key, property.initializer);
            }
          }
      });
    ts.forEachChild(node, visit);
  };
  visit(source);
}
