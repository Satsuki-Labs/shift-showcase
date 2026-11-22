import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const localPath = (file) =>
  relative(root, file.replace(/^[/\\]{2}\?[/\\]/, '')).replaceAll('\\', '/');
const ignored = new Set(['node_modules', 'dist', 'build', '.wrangler', '.vite', 'coverage']);

function sourceFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, directory, entry.name);
      if (entry.isDirectory()) return ignored.has(entry.name) ? [] : sourceFiles(path);
      return /\.(?:[cm]?js|tsx?|css|gs)$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

export function sources() {
  return ['frontend', 'server', 'shared', 'tools', 'gas'].flatMap(sourceFiles).map((file) => {
    const text = readFileSync(file, 'utf8');
    return {
      file,
      path: localPath(file),
      text,
      source: file.endsWith('.css')
        ? undefined
        : ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith('.gs') ? ts.ScriptKind.JS : undefined,
          ),
    };
  });
}

export function location(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}
