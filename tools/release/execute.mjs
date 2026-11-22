import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export function executeTool(tool, arguments_, { root, env, interactive }) {
  const prefix =
    tool === 'wrangler'
      ? [join(root, 'node_modules/wrangler/bin/wrangler.js')]
      : tool === 'npm'
        ? [
            process.env.npm_execpath ??
              join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
          ]
        : [];
  try {
    return String(
      execFileSync(
        ['git', 'gh'].includes(tool) ? tool : process.execPath,
        [...prefix, ...arguments_],
        {
          cwd: root,
          env,
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024,
          stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        },
      ) ?? '',
    ).trim();
  } catch (error) {
    const message = `${tool} ${arguments_[0]} が完了しませんでした。`;
    const details = String(error.stderr ?? '') || String(error.stdout ?? '');
    if (details) {
      const tail = details
        .replace(/\r?\n$/, '')
        .split('\n')
        .slice(-20)
        .join('\n');
      console.error(`${message}\n${tail}`);
    }
    throw new Error(message);
  }
}
