import ts from 'typescript';
import { location } from './files.mjs';

export function checkTypes(entries, report) {
  for (const { path, source, text } of entries) {
    if (!source) continue;
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        report('types/any', path, location(source, node), 'any');
      let inner = ts.isAsExpression(node) ? node.expression : undefined;
      while (inner && ts.isParenthesizedExpression(inner)) inner = inner.expression;
      if (
        ts.isAsExpression(node) &&
        inner &&
        ts.isAsExpression(inner) &&
        inner.type.kind === ts.SyntaxKind.UnknownKeyword
      )
        report('types/as-unknown-as', path, location(source, node), 'as unknown as');
      ts.forEachChild(node, visit);
    };
    visit(source);
    // コメントはASTの位置から集める。JSXの文字や正規表現の中をコメントと誤認しない。
    const comments = new Map();
    const collectComments = (node) => {
      for (const range of [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
      ])
        comments.set(range.pos, range);
      for (const child of node.getChildren(source)) collectComments(child);
    };
    collectComments(source);
    // ファイル末尾だけにあるコメントも対象にする。
    for (const range of ts.getLeadingCommentRanges(text, source.endOfFileToken.pos) ?? [])
      comments.set(range.pos, range);
    for (const { pos, end } of comments.values()) {
      const comment = text.slice(pos, end);
      for (const match of comment.matchAll(
        /@ts-ignore\b|@ts-expect-error\b|eslint-disable(?:-next-line|-line)?\b/g,
      )) {
        const category = match[0].startsWith('eslint') ? 'eslint-disable' : match[0].slice(1);
        report(
          `types/${category}`,
          path,
          source.getLineAndCharacterOfPosition(pos + match.index).line + 1,
          match[0],
        );
      }
    }
  }
}
