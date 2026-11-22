import { AppError } from '../../../shared/app-error';
import { MIGRATIONS, type Migration } from './migrations';

interface MigrationRecord {
  number: number;
  summary: string;
  additive?: boolean;
}

export async function applyMigrations(
  storage: DurableObjectStorage,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  let stage: 'check' | 'apply' = 'check';
  let number: number | null = null;
  try {
    const prepared = await Promise.all(
      migrations.map(async (migration) => {
        const sql = migration.sql.replace(/\r\n/g, '\n');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
        const summary = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        return { ...migration, sql, summary };
      }),
    );
    let applied = storage.kv.get<MigrationRecord[]>('schema:migrations') ?? [];
    if (prepared.length === 0) {
      number = applied[0]?.number ?? null;
      throw new AppError('E-43');
    }
    for (let index = 0; index < Math.max(prepared.length, applied.length); index++) {
      const migration = prepared[index];
      const record = applied[index];
      if (
        (migration && migration.number !== index + 1) ||
        (record && record.number !== index + 1) ||
        (migration && record && record.summary !== migration.summary) ||
        (!migration && record?.additive !== true)
      ) {
        number = migration?.number ?? record?.number ?? null;
        throw new AppError('E-43');
      }
    }

    const pending = prepared.slice(applied.length);
    if (pending.length === 0) return;
    stage = 'apply';
    storage.transactionSync(() => {
      for (const migration of pending) {
        number = migration.number;
        const nextApplied = [
          ...applied,
          {
            number: migration.number,
            summary: migration.summary,
            additive: migration.additive,
          },
        ];
        storage.sql.exec(migration.sql);
        if (migration.number === 1) {
          storage.sql.exec(
            'INSERT INTO data_version (id, schema_version, generation) VALUES (1, ?, ?)',
            migration.number,
            crypto.randomUUID(),
          );
        } else {
          storage.sql
            .exec(
              'UPDATE data_version SET schema_version = ? WHERE id = 1 RETURNING id',
              migration.number,
            )
            .one();
        }
        storage.kv.put('schema:migrations', nextApplied);
        applied = nextApplied;
      }
      storage.sql.exec(
        'UPDATE backup_state SET data_change_number = data_change_number + 1 WHERE id = 1',
      );
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'schema_change_failed',
        stage,
        number,
        ...(stage === 'apply'
          ? { message: error instanceof Error ? error.message : String(error) }
          : {}),
      }),
    );
    throw new AppError('E-43');
  }
}
