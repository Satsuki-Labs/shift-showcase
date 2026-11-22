import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { localPath, location, root } from './files.mjs';

const screens = new Set(['frame', 'pay', 'periods', 'request', 'shift', 'staff', 'yearly']);
const exceptions = [['frontend/src/shift/ShiftTab.tsx', 'frontend/src/yearly/DayDialog.tsx']];
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };

function specifierOf(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
    return node.moduleReference.expression;
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  )
    return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
}

function compilerOptions(file) {
  const config = ts.findConfigFile(dirname(file), ts.sys.fileExists);
  if (!config || localPath(config).startsWith('../')) return options;
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  return {
    ...ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config)).options,
    allowJs: true,
  };
}

export function checkImports(entries, report) {
  const configs = new Map();
  for (const { file, path: from, source } of entries) {
    if (!source) continue;
    const area = ts.findConfigFile(dirname(file), ts.sys.fileExists) ?? '';
    if (!configs.has(area)) configs.set(area, compilerOptions(file));
    const visit = (node) => {
      const specifier = specifierOf(node);
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const resolved = ts.resolveModuleName(
          specifier.text,
          file,
          configs.get(area),
          ts.sys,
        ).resolvedModule;
        const direct = resolve(dirname(file), specifier.text);
        const target =
          resolved?.resolvedFileName ?? (ts.sys.fileExists(direct) ? direct : undefined);
        const to = target ? localPath(target) : specifier.text;
        const fromFolder =
          from.startsWith('frontend/src/') && from.split('/').length > 3
            ? from.split('/')[2]
            : undefined;
        const toFolder = to.startsWith('frontend/src/') ? to.split('/')[2] : undefined;
        const forbidden =
          (from.startsWith('shared/') &&
            (/^(?:frontend|server|tools)\//.test(to) ||
              /^(?:react(?:-dom)?(?:\/|$)|node:|@shift-showcase\/)/.test(specifier.text))) ||
          (from.startsWith('server/') && to.startsWith('frontend/')) ||
          (from.startsWith('frontend/') && /^(?:server|tools)\//.test(to)) ||
          (toFolder &&
            screens.has(toFolder) &&
            ((fromFolder && fromFolder !== toFolder && from !== 'frontend/src/App.tsx') ||
              from.startsWith('tools/')));
        if (forbidden && !exceptions.some(([a, b]) => a === from && b === to))
          report('imports/direction', from, location(source, node), `${specifier.text} -> ${to}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
