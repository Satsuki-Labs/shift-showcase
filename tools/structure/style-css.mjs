import postcss from 'postcss';
import {
  exceptions,
  classExceptions,
  values,
  colors,
  size,
  variable,
  radius,
  shadow,
  directMotion,
  relativeSize,
  lineHeight,
} from './style-values.mjs';
function checkFont(declaration, fail, report, path) {
  const { prop, value, parent } = declaration;
  const line = declaration.source.start.line;

  const nodes = values(value);
  const sizeIndex = nodes.findIndex(
    (node) =>
      !node.quoted &&
      (/(?:px|pt|pc|in|cm|mm|q)$/.test(node.text) ||
        relativeSize(node.text) ||
        ['calc', 'min', 'max', 'clamp'].includes(node.name ?? '') ||
        /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/.test(
          node.text,
        )),
  );
  if (sizeIndex !== -1 && !size(nodes[sizeIndex])) fail();
  if (
    nodes
      .slice(0, sizeIndex === -1 ? nodes.length : sizeIndex)
      .some((node) => /^\d+$/.test(node.text) || /^(bold|bolder|lighter)$/.test(node.text))
  )
    fail();
  if (
    !parent?.nodes
      ?.slice(parent.nodes.indexOf(declaration) + 1)
      .some((node) => node.type === 'decl' && node.prop === 'line-height' && lineHeight(node.value))
  ) {
    report(path, line, prop, `${value}（後ろに決まりのline-heightがない）`);
  }
}

export function checkCss({ file, path, text }, classFiles, emit) {
  const report = (file, line, property, value) =>
    emit('styles/value', file, line, `${property}: ${value}`);
  const css = postcss.parse(text, { from: file });
  css.walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector)) {
      const name = /^\.([\w-]+)/.exec(selector)?.[1];
      if (
        !name ||
        classExceptions.some(
          (exception) =>
            exception.name === name &&
            exception.file === path &&
            exception.selectors.includes(selector),
        )
      )
        continue;
      const files = classFiles.get(name) ?? new Map();
      files.set(path, rule.source.start.line);
      classFiles.set(name, files);
    }
  });
  css.walkDecls((declaration) => {
    const { prop, value, parent } = declaration;
    if (
      path === 'frontend/src/styles/tokens.css' &&
      parent?.type === 'rule' &&
      parent.selector === ':root'
    )
      return;
    const context = [];
    for (let node = parent; node && node.type !== 'root'; node = node.parent) {
      context.unshift(
        node.type === 'rule'
          ? node.selector
          : node.type === 'atrule'
            ? `@${node.name}${node.params ? ` ${node.params}` : ''}`
            : '',
      );
    }
    if (
      exceptions.some(
        (exception) =>
          exception.file === path &&
          exception.property === prop &&
          exception.value === value &&
          exception.context === context.join(' > '),
      )
    )
      return;
    const line = declaration.source.start.line;
    const fail = () => report(path, line, prop, value);
    if (
      /^(transition|animation)(?:-(duration|delay|timing-function))?$/.test(prop) ||
      /^--.*(?:-duration|-easing)$/.test(prop) ||
      /^--(?:motion|ease)-/.test(prop)
    ) {
      if (directMotion(values(value))) fail();
    }
    if (colors(values(value)).length) fail();
    if (prop === 'font-size' && !values(value).every(size)) fail();
    if (prop === 'font-weight' && !variable(value) && value !== 'inherit') fail();
    if (
      /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/.test(prop) &&
      !radius(value)
    )
      fail();
    if (prop === 'box-shadow' && !shadow(value)) fail();
    const checkDropShadow = (nodes) =>
      nodes.forEach((node) => {
        if (
          node.name === 'drop-shadow' &&
          !shadow(node.text.slice(node.text.indexOf('(') + 1, -1).trim())
        )
          fail();
        if (node.children && node.name !== 'url') checkDropShadow(node.children);
      });
    checkDropShadow(values(value));
    if (prop === 'line-height' && !lineHeight(value)) fail();
    if (prop === 'font') checkFont(declaration, fail, report, path);
  });
}
