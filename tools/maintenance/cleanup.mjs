import { readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const organization = 'your-team.cloudflareaccess.com-org-token';
const application = 'shift-showcase.your-subdomain.workers.dev-';

function removeGroup(directory, names, label) {
  let removed = false;
  const failed = [];
  for (const name of names) {
    try {
      unlinkSync(join(directory, name));
      removed = true;
    } catch (error) {
      if (error.code !== 'ENOENT') failed.push(name);
    }
  }
  if (failed.length) console.error(`${label}：消せませんでした（${failed.join('、')}）`);
  else console.log(`${label}：${removed ? '消しました' : 'ありませんでした'}`);
  return failed.length > 0;
}

function cleanup(directory) {
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') names = [];
    else {
      console.error(`組織用の証明：消せませんでした（${organization}）`);
      console.error(`アプリ用の証明：消せませんでした（${application}*-token*）`);
      showInstructions();
      return;
    }
  }
  const organizationFailed = removeGroup(
    directory,
    names.filter((name) => name === organization),
    '組織用の証明',
  );
  const applicationFailed = removeGroup(
    directory,
    names.filter(
      (name) => name.startsWith(application) && name.includes('-token') && !name.endsWith('-jwks'),
    ),
    'アプリ用の証明',
  );
  if (organizationFailed || applicationFailed) showInstructions();
}

function showInstructions() {
  console.error('証明を消してください。');
}

export async function withCleanup(url, operation) {
  if (url.protocol !== 'https:') return operation();
  const directory = join(homedir(), '.cloudflared');
  let cleaned = false;
  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup(directory);
  };
  const interrupt = () => {
    cleanupOnce();
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  try {
    return await operation();
  } finally {
    process.off('SIGINT', interrupt);
    cleanupOnce();
  }
}
