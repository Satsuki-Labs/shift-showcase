import { addDays, japanDate, japanDateTime } from '../../../shared/date';
import { ERROR_CODES, type ErrorCode } from '../../../shared/error-codes';
import { HOLIDAYS_END_DATE } from '../../../shared/holidays';
import type { Role } from '../../../shared/protocol';
import type { BackupFailure } from '../backup/send';

export interface Mail {
  subject: string;
  body: string;
}
type MailState = {
  fatal_error_mailed_id: number;
  backup_failure_mailed_on: string | null;
  annual_task_mailed_on: string | null;
  stall_mailed_on: string | null;
};
export type DelayedTask = { task: string; scheduled_at: string };
type BackupState = {
  failed_nights: number;
  last_failure_code: BackupFailure;
  last_success_at: string | null;
};
type Fatal = {
  id: number;
  code: string;
  occurred_at: string;
  account: Role | null;
  operation: string;
};
export interface NightlyMail {
  mail: Mail;
  failure: boolean;
  recovery: boolean;
  annual: boolean;
  maxId: number;
}

const failureNames: Record<BackupFailure, string> = {
  'E-62': 'GASが断った',
  'E-63': 'Googleの上限',
  'E-64': 'GASにつながらない',
  'E-52': 'GASのURLか合言葉の設定が無い',
  'E-92': 'ファイルを作る途中の予期しないエラー',
};
const accounts: Record<Role, string> = { first: '第一', second: '第二', maintenance: '保守担当' };
const introduction =
  'シフトアプリ（GitHubのリポジトリ https://github.com/Satsuki-Labs/shift-showcase ）から、保守担当に次の知らせが届きました。下に挙げたコードを読んで調べてください。直す前に、調べた結果と直し方の案を報告してください。本番への公開と、Cloudflare・Googleの設定の変更は、保守担当が行います。';
const fence = (value: string) => '```\n' + value + '\n```';
const aiSection = (paragraphs: string[]) =>
  '\n\n――――――――――\nAIに貼る文（次の「```」の間を、そのまま貼ってください）\n' +
  fence([introduction, ...paragraphs].join('\n\n'));

function mailDate(now: Date): string {
  const date = japanDateTime(now);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}
function mailTime(value: string | null): string {
  if (!value) return 'まだ一度も成功していません';
  const date = japanDateTime(new Date(value));
  return `${mailDate(new Date(value))} ${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
const weekly = (last: string | null, today: string) => last === null || addDays(last, 7) <= today;

export function composeNightlyMail(sql: SqlStorage, now: Date): NightlyMail | null {
  const today = japanDate(now);
  const state = sql.exec<MailState>('SELECT * FROM mail_state WHERE id = 1').one();
  const backup = sql
    .exec<BackupState>(
      'SELECT failed_nights, last_failure_code, last_success_at FROM backup_state WHERE id = 1',
    )
    .one();
  const maxId = sql
    .exec<{ id: number }>('SELECT COALESCE(MAX(id), 0) AS id FROM fatal_errors')
    .one().id;
  const records = sql
    .exec<Fatal>(
      'SELECT * FROM fatal_errors WHERE id > ? AND id <= ? ORDER BY id',
      state.fatal_error_mailed_id,
      maxId,
    )
    .toArray();
  const missing = Math.max(0, maxId - state.fatal_error_mailed_id - records.length);
  const fatal = records.filter(
    (row) =>
      !Object.hasOwn(ERROR_CODES, row.code) ||
      ERROR_CODES[row.code as ErrorCode].display === 'always',
  );
  const failure = backup.failed_nights >= 2 && weekly(state.backup_failure_mailed_on, today);
  const recovery = backup.failed_nights === 0 && state.backup_failure_mailed_on !== null;
  const requiredYear = Number(today.slice(0, 4)) + (today.slice(5, 7) === '01' ? 0 : 1);
  const annual =
    HOLIDAYS_END_DATE < `${requiredYear}-12-31` && weekly(state.annual_task_mailed_on, today);
  const accountConfirmation = today.slice(5) === '02-01';
  const sections: string[] = [],
    ai: string[] = [];
  const success = mailTime(backup.last_success_at);
  if (failure) {
    const code = backup.last_failure_code;
    sections.push(
      '【バックアップに失敗しています】\n' +
        fence(
          `失敗の種類：${failureNames[code]}（${code}）\n最後に成功した日時：${success}\n続けて失敗した夜：${backup.failed_nights}夜`,
        ),
    );
    ai.push(
      `夜のバックアップが${backup.failed_nights}夜続けて失敗しています。最後に失敗した夜のエラー番号は${code}です。最後に成功したのは${success}です。gas/Code.gs と server/src/backup/ を見て、考えられる原因と、GASの実行の記録・スクリプトのプロパティ・アプリ専用のGoogleアカウントのDriveで確かめる所を、確かめる順に挙げてください。`,
    );
  }
  if (recovery) sections.push('【バックアップが戻りました】\n' + fence(`成功した日時：${success}`));
  if (fatal.length || missing) {
    const lines = fatal.map(
      (row) =>
        `${mailTime(row.occurred_at)}　${row.code}　${row.account === null ? '無し' : accounts[row.account]}　${row.operation}`,
    );
    if (missing) lines.push(`ほかに${missing}件（記録から消えたため、種類は分かりません）`);
    sections.push('【致命的なエラー】\n' + fence(lines.join('\n')));
    ai.push(
      '次の致命的なエラーが記録されました（日時、番号、アカウント、操作）：\n' +
        lines.join('\n') +
        '\nコードで起きうる場所を探して、原因の候補を挙げてください。起きてから3日以内のものは、Cloudflareの記録（Workers Logs）で同じ日時の行を探す手順も書いてください。',
    );
  }
  if (annual) {
    const year = Number(HOLIDAYS_END_DATE.slice(0, 4)) + 1;
    sections.push(`【年に1回の作業】\n${year}年の祝日が、まだ一覧にありません。`);
    ai.push(`${year}年の祝日を shared/holidays.ts に書き足してください。`);
  }
  if (accountConfirmation)
    sections.push(
      '【アプリ専用のアカウントの確認】\nアプリ専用のGoogleアカウントでログインし、Google Driveの「シフトのバックアップ」フォルダを開いてください（Googleが長く使われていないアカウントを消さないため）。',
    );
  if (!sections.length) return null;
  if (recovery && ai.length)
    ai.unshift(`夜のバックアップが戻りました。成功した日時は${success}です。`);
  return {
    mail: {
      subject: `シフトアプリ　保守のお知らせ（${mailDate(now)}）`,
      body: sections.join('\n\n') + (ai.length ? aiSection(ai) : ''),
    },
    failure,
    recovery,
    annual,
    maxId,
  };
}

export function composeStallMail(sql: SqlStorage, tasks: DelayedTask[]): Mail {
  const success = mailTime(
    sql
      .exec<{ last_success_at: string | null }>(
        'SELECT last_success_at FROM backup_state WHERE id = 1',
      )
      .one().last_success_at,
  );
  return {
    subject: 'シフトアプリ　バックアップが止まっています',
    body:
      '【バックアップが止まっています】\n予定の時刻を2時間過ぎても、動いていない自動の処理があります。\n' +
      fence(
        [
          ...tasks.map((task) => `遅れている予定：${task.task}　${mailTime(task.scheduled_at)}`),
          `最後にバックアップに成功した日時：${success}`,
        ].join('\n'),
      ) +
      aiSection([
        `自動の処理（Durable Objectの目覚まし）が止まっています。予定の時刻を2時間過ぎても残っている予定は${tasks.map((task) => `${task.task}（${mailTime(task.scheduled_at)}）`).join('、')}です。最後にバックアップに成功したのは${success}です。server/src/scheduled/tasks.ts、server/src/organization-object.ts を読み、目覚ましが止まる原因の候補と、Cloudflareの記録（Workers Logs）で確かめる所を挙げてください。`,
      ]),
  };
}
